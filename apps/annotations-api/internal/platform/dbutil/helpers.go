package dbutil

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

func RandomID(prefix string) string {
	bytes := make([]byte, 4)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixMilli())
	}
	if prefix == "" {
		return fmt.Sprintf("%s-%d", hex.EncodeToString(bytes), time.Now().UnixMilli())
	}
	return fmt.Sprintf("%s-%s-%d", prefix, hex.EncodeToString(bytes), time.Now().UnixMilli())
}

func RandomToken(byteLength int) string {
	if byteLength <= 0 {
		byteLength = 16
	}

	bytes := make([]byte, byteLength)
	if _, err := rand.Read(bytes); err != nil {
		return RandomID("")
	}
	return hex.EncodeToString(bytes)
}

func NullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}
