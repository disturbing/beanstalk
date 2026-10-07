package shop.billing;

import java.util.ArrayList;
import java.util.List;
import shop.core.Money;

public final class Payments {
    private Payments() {
    }

    public static boolean luhnOk(String number) {
        List<Integer> digits = new ArrayList<>();
        for (char c : number.toCharArray()) {
            if (Character.isDigit(c)) {
                digits.add(Character.digit(c, 10));
            }
        }
        if (digits.size() < 12) {
            return false;
        }
        int total = 0;
        for (int i = 0; i < digits.size(); i++) {
            int d = digits.get(digits.size() - 1 - i);
            if (i % 2 == 1) {
                d *= 2;
                if (d > 9) {
                    d -= 9;
                }
            }
            total += d;
        }
        return total % 10 == 0;
    }

    public static String charge(String card, Money amount) {
        if (amount.cents() <= 0) {
            return "rejected:amount";
        }
        if (!luhnOk(card)) {
            return "rejected:card";
        }
        return "approved";
    }
}
