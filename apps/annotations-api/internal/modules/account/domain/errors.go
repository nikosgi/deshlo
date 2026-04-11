package domain

import "errors"

var ErrAuthRequired = errors.New("auth required")
var ErrRepoNotFound = errors.New("repo not found")
var ErrKeyNotFound = errors.New("key not found")
