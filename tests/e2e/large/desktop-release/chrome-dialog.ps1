param(
    [Parameter(Mandatory)][int]$ChromeProcess,
    [Parameter(Mandatory)][ValidateSet('certificate', 'permission', 'install', 'folder', 'folder-permission', 'folder-persist')][string]$Operation,
    [Parameter(Mandatory)][string]$Value
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;
public static class ProbeWindow {
    private const uint GwOwner = 4;
    private delegate bool EnumWindow(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow visit, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr window, EnumWindow visit, IntPtr state);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint msg, UIntPtr wParam, string text, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr window, uint msg, UIntPtr wParam, IntPtr param, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint relation);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);

    public static uint ProcessOf(IntPtr window) {
        uint process = 0;
        if (window != IntPtr.Zero) GetWindowThreadProcessId(window, out process);
        return process;
    }

    public static uint OwnerOf(IntPtr window) {
        return ProcessOf(GetWindow(window, GwOwner));
    }

    public sealed class Window {
        public IntPtr Handle;
        public string ClassName;
        public uint Process;
        public uint Owner;
    }

    private static string ClassOf(IntPtr window) {
        var name = new StringBuilder(256);
        GetClassName(window, name, name.Capacity);
        return name.ToString();
    }

    public static string SubmitPath(IntPtr dialog, string path, bool folder) {
        var editors = new List<IntPtr>();
        var buttons = new List<IntPtr>();
        var controls = new List<string>();
        EnumChildWindows(dialog, (window, state) => {
            if (!IsWindowVisible(window)) return true;
            string name = ClassOf(window);
            int id = GetDlgCtrlID(window);
            controls.Add(name + ":" + id);
            if (name == "Button" && id == 1) buttons.Add(window); // IDOK
            if (name != "Edit") return true;
            if (folder && id == 1152) {
                editors.Add(window);
                return true;
            }
            for (IntPtr parent = window; !folder && parent != IntPtr.Zero && parent != dialog; parent = GetParent(parent)) {
                if (GetDlgCtrlID(parent) == 1148 || ClassOf(parent) == "FileNameControlHost") {
                    editors.Add(window);
                    break;
                }
            }
            return true;
        }, IntPtr.Zero);
        if (editors.Count != 1 || buttons.Count != 1) return String.Join(", ", controls.ToArray());

        UIntPtr result;
        const uint abortIfHung = 2, setText = 0x000C, click = 0x00F5;
        if (SendMessageTimeout(editors[0], setText, UIntPtr.Zero, path, abortIfHung, 2000, out result) == IntPtr.Zero || result == UIntPtr.Zero)
            throw new InvalidOperationException("Could not fill the Chrome-owned file picker.");
        if (SendMessageTimeout(buttons[0], click, UIntPtr.Zero, IntPtr.Zero, abortIfHung, 2000, out result) == IntPtr.Zero)
            throw new InvalidOperationException("Could not submit the Chrome-owned file picker.");
        return null;
    }

    public static Window[] VisibleWindows() {
        var windows = new List<Window>();
        EnumWindows((window, state) => {
            if (IsWindowVisible(window)) {
                windows.Add(new Window {
                    Handle = window, ClassName = ClassOf(window), Process = ProcessOf(window), Owner = OwnerOf(window)
                });
            }
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@
$ui = [System.Windows.Automation.AutomationElement]
$tree = [System.Windows.Automation.TreeScope]
$type = [System.Windows.Automation.ControlType]
$button = [System.Windows.Automation.PropertyCondition]::new($ui::ControlTypeProperty, $type::Button)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$timer = [Diagnostics.Stopwatch]::StartNew()
$observedPickers = @{}
while ($timer.Elapsed.TotalSeconds -lt 12) {
    foreach ($native in [ProbeWindow]::VisibleWindows()) {
        if ($Operation -in @('certificate', 'folder', 'install')) {
            if ($native.ClassName -ne '#32770' -or $native.Owner -ne $ChromeProcess) { continue }
            $controls = [ProbeWindow]::SubmitPath($native.Handle, $Value, $Operation -ne 'certificate')
            if ($null -ne $controls) {
                $observedPickers[$native.Handle.ToInt64()] = "pickerProcess=$($native.Process), ownerProcess=$($native.Owner), controls=$controls"
                continue
            }
            Write-Output 'Submitted Chrome-owned picker.'
            return
        }
        if ($native.Process -eq $ChromeProcess) {
            $accepted = switch ($Operation) {
                'folder-permission' { 'Allow' }
                'folder-persist' { 'Allow on every visit' }
                default { 'Allow'; 'Allow access' }
            }
            $window = $ui::FromHandle($native.Handle)
            foreach ($allow in $window.FindAll($tree::Descendants, $button)) {
                if (-not $allow.Current.IsEnabled -or $allow.Current.IsOffscreen -or $allow.Current.Name -notin $accepted) { continue }
                $bubble = $walker.GetParent($allow)
                for ($hops = 0; $bubble -and $hops -lt 4; $hops++) {
                    $texts = $bubble.FindAll($tree::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                    if ($texts | Where-Object { $_.Current.Name -and $_.Current.Name.Contains($Value) }) {
                        try {
                            $allow.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
                            return
                        } catch {
                            if ($_.Exception.InnerException -isnot [System.Windows.Automation.ElementNotEnabledException]) { throw }
                            break
                        }
                    }
                    $bubble = $walker.GetParent($bubble)
                }
            }
        }
    }
    Start-Sleep -Milliseconds 200
}
foreach ($observation in $observedPickers.Values) { Write-Output $observation }
$windows = [ProbeWindow]::VisibleWindows()
$session = (Get-Process -Id $PID).SessionId
$browserSession = (Get-Process -Id $ChromeProcess).SessionId
Write-Output "Desktop: automation session=$session, Chrome session=$browserSession, Chrome PID=$ChromeProcess"
$windows | ForEach-Object { Write-Output "Window: $($_.ClassName): PID=$($_.Process), owner=$($_.Owner)" }
throw "Chrome $Operation prompt was not reachable through Windows UI Automation (session $session)."
