package domain

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func CreateOAuthState(secret string) (string, error) {
	nonceBytes := make([]byte, 12)
	if _, err := rand.Read(nonceBytes); err != nil {
		return "", fmt.Errorf("generate oauth nonce: %w", err)
	}

	nonce := hex.EncodeToString(nonceBytes)
	ts := strconv.FormatInt(time.Now().UTC().Unix(), 10)
	payload := ts + ":" + nonce

	sig := sign(secret, payload)
	raw := payload + ":" + sig

	return base64.RawURLEncoding.EncodeToString([]byte(raw)), nil
}

func ValidateOAuthState(secret string, state string, maxAge time.Duration) error {
	decoded, err := base64.RawURLEncoding.DecodeString(state)
	if err != nil {
		return errors.New("invalid state encoding")
	}

	parts := strings.Split(string(decoded), ":")
	if len(parts) != 3 {
		return errors.New("invalid state format")
	}

	tsRaw := parts[0]
	nonce := parts[1]
	sig := parts[2]

	if nonce == "" || sig == "" {
		return errors.New("invalid state payload")
	}

	ts, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil {
		return errors.New("invalid state timestamp")
	}

	issuedAt := time.Unix(ts, 0).UTC()
	if time.Since(issuedAt) > maxAge {
		return errors.New("state expired")
	}

	expected := sign(secret, tsRaw+":"+nonce)
	if !hmac.Equal([]byte(expected), []byte(sig)) {
		return errors.New("invalid state signature")
	}

	return nil
}

func sign(secret string, payload string) string {
	h := hmac.New(sha256.New, []byte(secret))
	_, _ = h.Write([]byte(payload))
	return hex.EncodeToString(h.Sum(nil))
}
