package observability

import (
	"log"
	"os"
)

func NewLogger() *log.Logger {
	return log.New(os.Stdout, "[annotations-api] ", log.LstdFlags|log.Lmsgprefix)
}
