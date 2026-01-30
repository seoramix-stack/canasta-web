Write-Host "Killing Gradle Daemons..."
Get-Process -Name java, javaw -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*gradle*" } | Stop-Process -Force

Write-Host "Removing android/build..."
Remove-Item -Path "android/build" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Removing android/app/build..."
Remove-Item -Path "android/app/build" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Removing capacitor-cordova-android-plugins/build..."
Remove-Item -Path "android/capacitor-cordova-android-plugins/build" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Removing @capacitor/android build..."
Remove-Item -Path "node_modules/@capacitor/android/capacitor/build" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Cleaning complete. You can now try building again."
