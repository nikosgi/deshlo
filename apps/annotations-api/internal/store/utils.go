package store

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

func randomID(prefix string) string {
	bytes := make([]byte, 4)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixMilli())
	}
	if prefix == "" {
		return fmt.Sprintf("%s-%d", hex.EncodeToString(bytes), time.Now().UnixMilli())
	}
	return fmt.Sprintf("%s-%s-%d", prefix, hex.EncodeToString(bytes), time.Now().UnixMilli())
}

func randomToken(byteLength int) string {
	if byteLength <= 0 {
		byteLength = 16
	}

	bytes := make([]byte, byteLength)
	if _, err := rand.Read(bytes); err != nil {
		return randomID("")
	}
	return hex.EncodeToString(bytes)
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}
