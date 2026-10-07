// Package paths locates the module root so data and config files can be read at runtime.
package paths

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
)

var (
	rootOnce sync.Once
	rootDir  string
	rootErr  error
)

// Root walks up from the working directory until it finds go.mod.
func Root() (string, error) {
	rootOnce.Do(func() {
		dir, err := os.Getwd()
		if err != nil {
			rootErr = err
			return
		}
		for {
			if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
				rootDir = dir
				return
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				rootErr = errors.New("paths: go.mod not found above working directory")
				return
			}
			dir = parent
		}
	})
	return rootDir, rootErr
}

// Data returns the path of a file under <root>/data.
func Data(name string) (string, error) { return under("data", name) }

// Config returns the path of a file under <root>/config.
func Config(name string) (string, error) { return under("config", name) }

// File returns the path of a file relative to the module root.
func File(rel ...string) (string, error) { return under(rel...) }

func under(parts ...string) (string, error) {
	root, err := Root()
	if err != nil {
		return "", err
	}
	return filepath.Join(append([]string{root}, parts...)...), nil
}
