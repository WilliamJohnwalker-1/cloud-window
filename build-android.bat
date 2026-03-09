@echo off
REM ====================================
REM   Android APK 快速构建脚本
REM   版本: 2.1.0
REM   使用 EAS Build
REM ====================================

echo.
echo ==========================================
echo   1. 登录 Expo 账户
echo ==========================================
echo.
echo 如果已有 Expo 账户，输入邮箱地址并按提示登录
echo 如果没有账户，请先访问 https://expo.dev 注册
echo.
eas login

echo.
echo ==========================================
echo   2. 验证登录状态
echo ==========================================
echo.
eas whoami

echo.
echo ==========================================
echo   3. 开始构建 Android APK
echo ==========================================
echo.
echo 版本: 2.1.0
echo 预计时间: 15-20 分钟
echo.
echo 请勿关闭此窗口，构建期间请保持网络连接
echo.
eas build --platform android --profile production

echo.
echo ==========================================
echo   构建完成！
echo ==========================================
echo.
echo 请查看上方的 Build ID
echo 然后执行以下命令下载 APK:
echo   eas build:view [BUILD_ID]
echo.
echo 或者访问:
echo   https://expo.dev
echo 登录后进入 "Builds" 页面下载
echo.
pause