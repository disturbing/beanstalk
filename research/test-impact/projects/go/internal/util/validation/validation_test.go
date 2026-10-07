package validation

import "testing"

func TestValidationFormats(t *testing.T) {
	if !IsSKU("SKU-123") || IsSKU("SKU-12") || !IsEmail("a@b.io") || IsEmail("a@b") {
		t.Fatal("validation")
	}
}
