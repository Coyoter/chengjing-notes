package main

import (
	"archive/zip"
	"bytes"
	"debug/pe"
	_ "embed"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed payload.zip
var payload []byte

var appVersion = "0.0.0"
var expectedArch = "arm64"

const (
	machineAMD64 = 0x8664
	machineARM64 = 0xaa64
	mbOK         = 0x00000000
	mbIconError  = 0x00000010
)

func main() {
	logPath := filepath.Join(os.TempDir(), "ChengJing-install.log")
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if logFile != nil {
		defer logFile.Close()
		log.SetOutput(logFile)
	}
	log.Printf("starting ChengJing %s %s installer", appVersion, expectedArch)
	if err := install(); err != nil {
		log.Printf("installation failed: %v", err)
		messageBox("澄境安裝失敗。\n\n"+err.Error()+"\n\n診斷紀錄："+logPath, "澄境安裝", mbOK|mbIconError)
		os.Exit(1)
	}
}

func install() error {
	localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA"))
	if localAppData == "" {
		return fmt.Errorf("Windows 沒有提供 LOCALAPPDATA 路徑")
	}
	installDir := filepath.Join(localAppData, "Programs", "ChengJing")
	stagingDir := installDir + ".installing-" + strconv.Itoa(os.Getpid())
	backupDir := installDir + ".previous"
	log.Printf("install directory: %s", installDir)

	_ = runHidden("taskkill.exe", "/IM", "ChengJing.exe", "/F")
	time.Sleep(250 * time.Millisecond)
	_ = os.RemoveAll(stagingDir)
	if err := os.MkdirAll(stagingDir, 0o755); err != nil {
		return fmt.Errorf("無法建立暫存安裝資料夾：%w", err)
	}
	defer os.RemoveAll(stagingDir)
	if err := extractPayload(stagingDir); err != nil {
		return err
	}
	applicationPath := filepath.Join(stagingDir, "ChengJing.exe")
	if err := verifyExecutable(applicationPath, expectedArch); err != nil {
		return err
	}
	uninstallerPath := filepath.Join(stagingDir, "ChengJingUninstall.exe")
	if _, err := os.Stat(uninstallerPath); err != nil {
		return fmt.Errorf("安裝內容缺少 ChengJingUninstall.exe：%w", err)
	}

	_ = os.RemoveAll(backupDir)
	if _, err := os.Stat(installDir); err == nil {
		if err := os.Rename(installDir, backupDir); err != nil {
			return fmt.Errorf("無法替換舊版澄境，請先完整結束程式：%w", err)
		}
	}
	if err := os.Rename(stagingDir, installDir); err != nil {
		_ = os.Rename(backupDir, installDir)
		return fmt.Errorf("無法完成應用程式安裝：%w", err)
	}
	_ = os.RemoveAll(backupDir)

	applicationPath = filepath.Join(installDir, "ChengJing.exe")
	uninstallerPath = filepath.Join(installDir, "ChengJingUninstall.exe")
	if err := createShortcuts(applicationPath, installDir); err != nil {
		log.Printf("shortcut warning: %v", err)
	}
	if err := registerUninstaller(installDir, applicationPath, uninstallerPath); err != nil {
		log.Printf("uninstall registration warning: %v", err)
	}
	command := exec.Command(applicationPath)
	command.Dir = installDir
	if err := command.Start(); err != nil {
		return fmt.Errorf("程式已安裝，但無法啟動：%w", err)
	}
	log.Printf("installation completed")
	return nil
}

func extractPayload(destinationRoot string) error {
	reader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("安裝內容損壞：%w", err)
	}
	root := strings.ToLower(filepath.Clean(destinationRoot) + string(os.PathSeparator))
	for _, item := range reader.File {
		relative := filepath.Clean(filepath.FromSlash(item.Name))
		if relative == "." || relative == "" {
			continue
		}
		target := filepath.Clean(filepath.Join(destinationRoot, relative))
		if !strings.HasPrefix(strings.ToLower(target), root) {
			return fmt.Errorf("安裝內容包含不安全路徑：%s", item.Name)
		}
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("建立資料夾失敗：%w", err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("建立資料夾失敗：%w", err)
		}
		source, err := item.Open()
		if err != nil {
			return fmt.Errorf("讀取安裝內容失敗：%w", err)
		}
		destination, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, item.Mode())
		if err != nil {
			source.Close()
			return fmt.Errorf("寫入 %s 失敗：%w", item.Name, err)
		}
		_, copyErr := io.Copy(destination, source)
		closeDestinationErr := destination.Close()
		closeSourceErr := source.Close()
		if copyErr != nil {
			return fmt.Errorf("解壓 %s 失敗：%w", item.Name, copyErr)
		}
		if closeDestinationErr != nil || closeSourceErr != nil {
			return fmt.Errorf("完成 %s 失敗", item.Name)
		}
	}
	return nil
}

func verifyExecutable(filePath, architecture string) error {
	file, err := pe.Open(filePath)
	if err != nil {
		return fmt.Errorf("ChengJing.exe 不是有效的 Windows 程式：%w", err)
	}
	defer file.Close()
	expectedMachine := uint16(machineARM64)
	if architecture == "x64" {
		expectedMachine = machineAMD64
	}
	if file.FileHeader.Machine != expectedMachine {
		return fmt.Errorf("ChengJing.exe 架構錯誤：需要 %s，實際為 0x%x", architecture, file.FileHeader.Machine)
	}
	return nil
}

func createShortcuts(applicationPath, installDir string) error {
	quotedApplication := powerShellQuote(applicationPath)
	quotedDirectory := powerShellQuote(installDir)
	script := "$w=New-Object -ComObject WScript.Shell;" +
		"$paths=@((Join-Path ([Environment]::GetFolderPath('Desktop')) '澄境.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) '澄境.lnk'));" +
		"foreach($p in $paths){$s=$w.CreateShortcut($p);$s.TargetPath='" + quotedApplication + "';$s.WorkingDirectory='" + quotedDirectory + "';$s.IconLocation='" + quotedApplication + ",0';$s.Description='澄境 ChengJing';$s.Save()}"
	return runHidden("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
}

func registerUninstaller(installDir, applicationPath, uninstallerPath string) error {
	key := `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ChengJing`
	size := directorySize(installDir) / 1024
	values := [][]string{
		{"DisplayName", "REG_SZ", "澄境 " + appVersion},
		{"DisplayVersion", "REG_SZ", appVersion},
		{"Publisher", "REG_SZ", "Techtarian"},
		{"InstallLocation", "REG_SZ", installDir},
		{"DisplayIcon", "REG_SZ", applicationPath + ",0"},
		{"UninstallString", "REG_SZ", `"` + uninstallerPath + `"`},
		{"QuietUninstallString", "REG_SZ", `"` + uninstallerPath + `" --silent`},
		{"EstimatedSize", "REG_DWORD", strconv.FormatInt(size, 10)},
		{"NoModify", "REG_DWORD", "1"},
		{"NoRepair", "REG_DWORD", "1"},
	}
	for _, value := range values {
		if err := runHidden("reg.exe", "add", key, "/v", value[0], "/t", value[1], "/d", value[2], "/f"); err != nil {
			return fmt.Errorf("寫入移除資訊 %s 失敗：%w", value[0], err)
		}
	}
	return nil
}

func directorySize(root string) int64 {
	var total int64
	_ = filepath.Walk(root, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}

func runHidden(name string, arguments ...string) error {
	command := exec.Command(name, arguments...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Run()
}

func powerShellQuote(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func messageBox(text, title string, flags uintptr) int {
	textPointer, _ := syscall.UTF16PtrFromString(text)
	titlePointer, _ := syscall.UTF16PtrFromString(title)
	result, _, _ := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(textPointer)), uintptr(unsafe.Pointer(titlePointer)), flags)
	return int(result)
}
