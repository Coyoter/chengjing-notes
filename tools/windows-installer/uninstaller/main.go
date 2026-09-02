package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

var appVersion = "0.0.0"

const (
	mbOK              = 0x00000000
	mbYesNo           = 0x00000004
	mbIconInformation = 0x00000040
	mbIconQuestion    = 0x00000020
	idYes             = 6
)

func main() {
	if len(os.Args) >= 3 && os.Args[1] == "--execute" {
		performUninstall(os.Args[2], false)
		return
	}
	if len(os.Args) >= 3 && os.Args[1] == "--execute-silent" {
		performUninstall(os.Args[2], true)
		return
	}
	silent := len(os.Args) >= 2 && os.Args[1] == "--silent"
	executable, err := os.Executable()
	if err != nil {
		return
	}
	installDir := filepath.Dir(executable)
	if !silent && messageBox("要移除澄境 "+appVersion+" 嗎？\n\n筆記與設定會保留。", "移除澄境", mbYesNo|mbIconQuestion) != idYes {
		return
	}
	temporary := filepath.Join(os.TempDir(), fmt.Sprintf("ChengJingUninstall-%d.exe", os.Getpid()))
	if err := copyFile(executable, temporary); err != nil {
		messageBox("無法準備移除程式："+err.Error(), "移除澄境", mbOK)
		return
	}
	mode := "--execute"
	if silent {
		mode = "--execute-silent"
	}
	command := exec.Command(temporary, mode, installDir)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := command.Start(); err != nil {
		messageBox("無法啟動移除程式："+err.Error(), "移除澄境", mbOK)
	}
}

func performUninstall(installDir string, silent bool) {
	_ = runHidden("taskkill.exe", "/IM", "ChengJing.exe", "/F")
	time.Sleep(400 * time.Millisecond)
	removeShortcuts()
	_ = runHidden("reg.exe", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ChengJing`, "/f")
	if err := os.RemoveAll(installDir); err != nil && !silent {
		messageBox("部分程式檔案無法移除："+err.Error(), "移除澄境", mbOK)
		return
	}
	if !silent {
		messageBox("澄境已移除。\n\n筆記與設定仍保留在這台電腦。", "移除澄境", mbOK|mbIconInformation)
	}
	self, _ := os.Executable()
	command := exec.Command("cmd.exe", "/C", "ping 127.0.0.1 -n 3 >nul & del /F /Q \""+self+"\"")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = command.Start()
}

func removeShortcuts() {
	script := "$paths=@((Join-Path ([Environment]::GetFolderPath('Desktop')) '澄境.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) '澄境.lnk'));foreach($p in $paths){Remove-Item $p -Force -ErrorAction SilentlyContinue}"
	_ = runHidden("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o700)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func runHidden(name string, arguments ...string) error {
	command := exec.Command(name, arguments...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Run()
}

func messageBox(text, title string, flags uintptr) int {
	textPointer, _ := syscall.UTF16PtrFromString(text)
	titlePointer, _ := syscall.UTF16PtrFromString(title)
	result, _, _ := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(textPointer)), uintptr(unsafe.Pointer(titlePointer)), flags)
	return int(result)
}
