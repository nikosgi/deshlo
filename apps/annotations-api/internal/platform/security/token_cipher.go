package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
)

type TokenCipher struct {
	aead cipher.AEAD
}

func NewTokenCipher(keyRaw string) (*TokenCipher, error) {
	key, err := parseTokenEncryptionKey(keyRaw)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create aes cipher: %w", err)
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create aes-gcm: %w", err)
	}

	return &TokenCipher{aead: aead}, nil
}

func (c *TokenCipher) Encrypt(plaintext string) (string, error) {
	trimmed := strings.TrimSpace(plaintext)
	if trimmed == "" {
		return "", nil
	}

	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("read nonce: %w", err)
	}

	ciphertext := c.aead.Seal(nil, nonce, []byte(trimmed), nil)
	combined := append(nonce, ciphertext...)
	return base64.StdEncoding.EncodeToString(combined), nil
}

func (c *TokenCipher) Decrypt(ciphertext string) (string, error) {
	trimmed := strings.TrimSpace(ciphertext)
	if trimmed == "" {
		return "", nil
	}

	combined, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return "", fmt.Errorf("decode encrypted token: %w", err)
	}

	nonceSize := c.aead.NonceSize()
	if len(combined) < nonceSize {
		return "", fmt.Errorf("invalid encrypted token payload")
	}

	nonce := combined[:nonceSize]
	enc := combined[nonceSize:]
	plaintext, err := c.aead.Open(nil, nonce, enc, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt token: %w", err)
	}

	return string(plaintext), nil
}

func parseTokenEncryptionKey(value string) ([]byte, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, fmt.Errorf("DESHLO_TOKEN_ENCRYPTION_KEY is required")
	}

	candidates := make([][]byte, 0, 3)

	if decoded, err := base64.StdEncoding.DecodeString(trimmed); err == nil {
		candidates = append(candidates, decoded)
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(trimmed); err == nil {
		candidates = append(candidates, decoded)
	}
	if decoded, err := hex.DecodeString(trimmed); err == nil {
		candidates = append(candidates, decoded)
	}

	for _, candidate := range candidates {
		if isValidAESKeyLength(len(candidate)) {
			return candidate, nil
		}
	}

	if isValidAESKeyLength(len(trimmed)) {
		return []byte(trimmed), nil
	}

	return nil, fmt.Errorf("DESHLO_TOKEN_ENCRYPTION_KEY must be 16/24/32-byte raw or base64/hex encoded")
}

func isValidAESKeyLength(length int) bool {
	return length == 16 || length == 24 || length == 32
}
