package catalog

import (
	"errors"
	"testing"
)

func TestCatalogSize(t *testing.T) {
	all, err := Catalog()
	if err != nil || len(all) != 6 {
		t.Fatalf("catalog %d, %v", len(all), err)
	}
}

func TestCatalogFind(t *testing.T) {
	p, err := Find("SKU-002")
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Tea Kettle" || p.Price.Cents != 3500 {
		t.Fatalf("got %+v", p)
	}
}

func TestCatalogMissing(t *testing.T) {
	_, err := Find("SKU-999")
	var nf NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("expected NotFoundError, got %v", err)
	}
}

func TestCatalogByCategory(t *testing.T) {
	ps, err := ByCategory("office")
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 2 || ps[0].SKU != "SKU-003" || ps[1].SKU != "SKU-004" {
		t.Fatalf("got %+v", ps)
	}
}
