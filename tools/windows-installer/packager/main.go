package main

import (
	"archive/zip"
	"compress/flate"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	source := flag.String("source", "", "directory to package")
	output := flag.String("output", "", "zip file to write")
	flag.Parse()
	if *source == "" || *output == "" {
		fatalf("both -source and -output are required")
	}
	if err := createZip(filepath.Clean(*source), filepath.Clean(*output)); err != nil {
		fatalf("%v", err)
	}
}

func createZip(source, output string) error {
	stat, err := os.Stat(source)
	if err != nil {
		return fmt.Errorf("inspect source: %w", err)
	}
	if !stat.IsDir() {
		return fmt.Errorf("source is not a directory: %s", source)
	}
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	temporary := output + ".tmp"
	_ = os.Remove(temporary)
	file, err := os.Create(temporary)
	if err != nil {
		return fmt.Errorf("create zip: %w", err)
	}
	archive := zip.NewWriter(file)
	archive.RegisterCompressor(zip.Deflate, func(writer io.Writer) (io.WriteCloser, error) {
		return flate.NewWriter(writer, flate.BestCompression)
	})

	walkErr := filepath.WalkDir(source, func(current string, entry os.DirEntry, walkError error) error {
		if walkError != nil {
			return walkError
		}
		if current == source {
			return nil
		}
		relative, err := filepath.Rel(source, current)
		if err != nil {
			return err
		}
		if strings.EqualFold(entry.Name(), ".DS_Store") {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(relative)
		if entry.IsDir() {
			header.Name += "/"
		} else {
			header.Method = zip.Deflate
		}
		destination, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		sourceFile, err := os.Open(current)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(destination, sourceFile)
		closeErr := sourceFile.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
	closeArchiveErr := archive.Close()
	closeFileErr := file.Close()
	if walkErr != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("package files: %w", walkErr)
	}
	if closeArchiveErr != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("finish zip: %w", closeArchiveErr)
	}
	if closeFileErr != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("flush zip: %w", closeFileErr)
	}
	_ = os.Remove(output)
	if err := os.Rename(temporary, output); err != nil {
		return fmt.Errorf("publish zip: %w", err)
	}
	return nil
}

func fatalf(format string, values ...any) {
	fmt.Fprintf(os.Stderr, "windows installer packager: "+format+"\n", values...)
	os.Exit(1)
}
