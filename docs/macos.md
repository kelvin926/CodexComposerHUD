# Codex Composer HUD for Apple Silicon

macOS 13.5 이상과 Apple Silicon(M1 이후)용 비공식 표시기입니다. 공식 Codex/ChatGPT 데스크톱 앱의 입력창에 사용량 UI를 추가합니다. Node ARM64 런타임이 포함되어 있습니다.

## 설치

최신 릴리스의 `CodexComposerHUD-macOS-arm64.pkg`를 열어 설치합니다. `응용 프로그램`의 **Codex Composer HUD**를 실행하세요.

ZIP을 사용하려면 `CodexComposerHUD-macOS-arm64.zip`을 풀고 앱을 `응용 프로그램`으로 옮깁니다. ZIP으로 설치하면 관리자 권한이 필요하지 않습니다.

Apple 개발자 인증서 서명과 공증은 제공하지 않습니다. macOS에서 실행 또는 설치가 차단될 수 있습니다. 직접 확인한 다운로드에 대해서만 시스템 설정의 개인정보 보호 및 보안에서 제공하는 허용 절차를 사용하세요.

## 사용

공식 앱에 로그인한 상태에서 현재 작업을 마치고 앱을 완전히 종료한 뒤 **Codex Composer HUD**를 실행합니다. 기존 표시기로 연 앱은 다시 연결합니다. 앱 내부의 모델 선택기 왼쪽에 사용량이 표시됩니다.

주간 잔여는 계정 전체 값이며, ‘이 채팅 주간 소모 추정’은 확인한 계정 사용률 증가를 각 채팅의 요청 기록에 따라 배분한 값입니다. 기록이 없는 사용은 미분류입니다. 정확한 채팅별 한도 계산식은 앱이 제공하지 않습니다.

클라우드 채팅의 과거 기록과 실제 macOS 로그인 화면의 전체 UI 동작은 검증되지 않았습니다. 지원 대상은 `app.asar`를 사용하는 공식 Codex/ChatGPT 앱입니다.

## 종료와 제거

Codex Composer HUD의 메뉴에서 **표시기 종료**를 선택하면 추가 UI를 제거합니다. 공식 앱과 작업은 유지됩니다. 제거하려면 표시기를 종료한 뒤 `CodexComposerHUD.app`을 휴지통으로 옮깁니다. 업그레이드 전에도 표시기를 종료하세요.

상태와 대화 내용 없는 로그는 `~/Library/Application Support/CodexComposerHUD`에 저장됩니다. 공식 앱, 로그인 정보, `~/.codex/config.toml`은 변경하지 않습니다. localhost 디버깅 포트는 공식 앱을 완전히 종료할 때 닫힙니다.

## 소스 빌드

macOS에서 Xcode Command Line Tools와 Python 3.10 이상이 필요합니다.

```bash
python3 scripts/build_macos.py
```

`dist/`에 ARM64 앱 ZIP과 설치 PKG, SHA-256이 생성됩니다. 빌드와 런타임 검증은 GitHub Actions의 macOS ARM64 환경에서 수행합니다.

## 자동 연결

설치 또는 첫 실행은 개인 LaunchAgent를 등록하고 현재 Dock의 공식 Codex 항목을 연결합니다. 원본 Dock 항목은 백업하며, 개인 실행 중계 앱은 공식 앱의 원본 아이콘을 사용합니다. 아이콘을 보존할 수 없는 경우에는 Dock 항목을 바꾸지 않습니다. 공식 앱 파일은 수정하지 않습니다. 로그인 시 앱을 혼자 열지 않고 대기합니다. 직접 공식 앱 파일을 열면 연결되지 않을 수 있습니다.

메뉴의 **자동 연결 끄기**를 먼저 사용한 뒤 앱을 제거하면 LaunchAgent를 제거하고 연결된 Dock 항목을 복원합니다.
