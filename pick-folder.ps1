param([string]$ResultFile, [string]$InitialFolder, [switch]$Check, [switch]$PickFile)
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class ModernFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")] class FileOpenDialog {}
  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr types);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName(out IntPtr name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr context, ref Guid handler, ref Guid id, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint type, out IntPtr name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem other, uint hint, out int order);
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
  static extern void SHCreateItemFromParsingName(string name, IntPtr context, ref Guid id, out IShellItem item);
  public static string Choose(string initial, bool check, bool fileMode) {
    var dialog = (IFileDialog)new FileOpenDialog();
    try {
      uint options; dialog.GetOptions(out options);
      dialog.SetOptions(options | 0x40 | 0x800 | (fileMode ? 0x1000u : 0x20u));
      dialog.SetTitle(fileMode ? "Select media file" : "Select video folder");
      dialog.SetOkButtonLabel(fileMode ? "Select file" : "Select folder");
      if (System.IO.Directory.Exists(initial)) {
        Guid id = typeof(IShellItem).GUID; IShellItem folder;
        SHCreateItemFromParsingName(initial, IntPtr.Zero, ref id, out folder);
        try { dialog.SetFolder(folder); } finally { Marshal.ReleaseComObject(folder); }
      }
      if (check) return "OK";
      int result;
      using (var owner = new Form()) {
        owner.ShowInTaskbar = false;
        owner.FormBorderStyle = FormBorderStyle.None;
        owner.StartPosition = FormStartPosition.CenterScreen;
        owner.Size = new System.Drawing.Size(900, 600);
        owner.Location = new System.Drawing.Point(
          Screen.PrimaryScreen.WorkingArea.Left +
          (Screen.PrimaryScreen.WorkingArea.Width - 900) / 2,
          Screen.PrimaryScreen.WorkingArea.Top +
          (Screen.PrimaryScreen.WorkingArea.Height - 600) / 2);
        owner.Opacity = 0.01;
        owner.TopMost = true;
        owner.Show();
        owner.Activate();
        result = dialog.Show(owner.Handle);
      }
      if (result == unchecked((int)0x800704C7)) return null;
      Marshal.ThrowExceptionForHR(result);
      IShellItem item; dialog.GetResult(out item);
      try {
        IntPtr name; item.GetDisplayName(0x80058000, out name);
        try { return Marshal.PtrToStringUni(name); } finally { Marshal.FreeCoTaskMem(name); }
      } finally { Marshal.ReleaseComObject(item); }
    } finally { Marshal.ReleaseComObject(dialog); }
  }
}
'@
$selected = [ModernFolderPicker]::Choose($InitialFolder, $Check.IsPresent, $PickFile.IsPresent)
if ($Check) { $selected; exit }
[IO.File]::WriteAllText($ResultFile, (ConvertTo-Json -Compress @{path=$selected}), [Text.UTF8Encoding]::new($false))
