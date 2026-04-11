package security

import "testing"

func TestTokenCipherRoundTrip(t *testing.T) {
	cipher, err := NewTokenCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatalf("NewTokenCipher returned error: %v", err)
	}

	encrypted, err := cipher.Encrypt("ghu_test_token")
	if err != nil {
		t.Fatalf("Encrypt returned error: %v", err)
	}
	if encrypted == "" {
		t.Fatalf("Encrypt returned empty value")
	}

	decrypted, err := cipher.Decrypt(encrypted)
	if err != nil {
		t.Fatalf("Decrypt returned error: %v", err)
	}
	if decrypted != "ghu_test_token" {
		t.Fatalf("Decrypt mismatch: got %q", decrypted)
	}
}

func TestTokenCipherRejectsInvalidKey(t *testing.T) {
	if _, err := NewTokenCipher("abc"); err == nil {
		t.Fatalf("expected invalid key error")
	}
}
