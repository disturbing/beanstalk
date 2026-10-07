// Package ids builds short hashed ids and zero-padded sequences.
package ids

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"
)

// ShortID hashes the parts and returns prefix-<8 hex chars>.
func ShortID(prefix string, parts ...any) string {
	s := make([]string, len(parts))
	for i, p := range parts {
		s[i] = fmt.Sprint(p)
	}
	sum := sha1.Sum([]byte(strings.Join(s, "|")))
	return prefix + "-" + hex.EncodeToString(sum[:])[:8]
}

// Sequence hands out prefix00001, prefix00002, ...
type Sequence struct {
	Prefix string
	Next   int
}

// NewSequence starts a sequence at start.
func NewSequence(prefix string, start int) *Sequence {
	return &Sequence{Prefix: prefix, Next: start}
}

// Take returns the next value.
func (s *Sequence) Take() string {
	v := fmt.Sprintf("%s%05d", s.Prefix, s.Next)
	s.Next++
	return v
}
