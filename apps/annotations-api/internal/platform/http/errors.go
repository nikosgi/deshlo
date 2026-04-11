package http

import "net/http"

func WriteError(w http.ResponseWriter, statusCode int, code string) {
	WriteJSON(w, statusCode, map[string]any{"ok": false, "message": code})
}

func WriteAuthRequired(w http.ResponseWriter) {
	WriteError(w, http.StatusUnauthorized, "AUTH_REQUIRED")
}

func WriteProviderError(w http.ResponseWriter) {
	WriteError(w, http.StatusInternalServerError, "PROVIDER_ERROR")
}

func WriteNotFound(w http.ResponseWriter, code string) {
	WriteError(w, http.StatusNotFound, code)
}

func WriteBadRequest(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusBadRequest, message)
}
