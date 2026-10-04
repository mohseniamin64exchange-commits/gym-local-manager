Set shell = CreateObject("Shell.Application")
' BIF_RETURNONLYFSDIRS + BIF_NEWDIALOGSTYLE: the modern Windows folder picker.
Set folder = shell.BrowseForFolder(0, "پوشه ویدئوها را انتخاب کنید", &H50)
If Not folder Is Nothing Then
  Set fileSystem = CreateObject("Scripting.FileSystemObject")
  Set output = fileSystem.OpenTextFile(WScript.Arguments(0), 2, True)
  output.Write folder.Self.Path
  output.Close
End If
