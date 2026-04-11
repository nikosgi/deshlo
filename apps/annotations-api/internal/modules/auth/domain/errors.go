package domain

import "errors"

var ErrAuthRequired = errors.New("auth required")
var ErrOAuthStateInvalid = errors.New("oauth state invalid")
