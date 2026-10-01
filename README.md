# Codex Composer HUD

Codex 입력창에서 컨텍스트, 주간 한도, 캐시와 예상 소모를 확인하는 비공식 도구입니다. 모델 선택기 왼쪽에 작은 사용량 표시를 추가하며, 상세 정보는 접고 펼치는 팝업으로 확인합니다.

OpenAI 공식 제품이나 공식 확장 기능이 아닙니다. 앱 파일을 수정하지 않고 localhost Chrome DevTools Protocol로 화면 메모리에 UI를 추가합니다.

## 다운로드

[최신 릴리스](https://github.com/kelvin926/CodexComposerHUD/releases/latest)에서 운영체제에 맞는 파일을 받으세요.

| 운영체제 | 파일 |
| --- | --- |
| macOS 13.5+ Apple Silicon | `CodexComposerHUD-macOS-arm64.pkg` 또는 앱 ZIP |
| Windows 10/11 x64 | `CodexComposerHUD-Setup.exe` 또는 `CodexComposerHUD.zip` |
| Ubuntu 24.04 Intel/AMD | `codex-composer-hud_1.6.0-1_amd64.deb` |
| Ubuntu 24.04 ARM64 | `codex-composer-hud_1.6.0-1_arm64.deb` |

생성한 앱 아이콘이 Windows 실행 파일, 설치 화면, Ubuntu 앱 메뉴와 Mac 앱에 포함됩니다.

Node 런타임이 포함되어 별도 Node 설치가 필요하지 않습니다. SHA-256 파일도 함께 제공합니다. 설치 파일에는 GitHub 빌드 서명과 검증용 번들이 제공됩니다. Windows Authenticode와 Apple Developer ID 서명은 아직 없습니다. [서명 정책](docs/SIGNING.md)을 참고하세요.

## 설치

Windows는 설치 파일을 실행하세요. 기본 선택인 자동 연결은 실제 Codex를 가리키는 개인 시작 메뉴 및 작업 표시줄 바로가기를 백업한 뒤 연결 실행기로 바꿉니다. 로그인 시 표시기가 조용히 대기하며 Codex를 혼자 실행하지 않습니다. 현재 사용자 계정에 설치되며 관리자 권한이 필요하지 않습니다.

Ubuntu는 공식 ChatGPT Linux 앱을 먼저 설치하고 로그인한 뒤 다음 명령을 사용합니다. ARM64 컴퓨터는 해당 파일명을 사용합니다.

```bash
sudo apt install ./codex-composer-hud_1.6.0-1_amd64.deb
codex-composer-hud
```

연결된 Codex 바로가기를 사용하면 표시기가 함께 적용됩니다. 일반 실행으로 이미 열린 앱에는 연결 포트가 없을 수 있으므로 작업을 마친 뒤 완전히 종료하고 연결된 바로가기로 다시 엽니다. 현재 작업을 강제로 종료하지 않습니다. 공식 앱 파일은 수정하지 않습니다.

실행 파일을 직접 실행하거나 다른 도구에서 우회 실행하면 자동 연결이 적용되지 않을 수 있습니다. Ubuntu는 첫 로그인 또는 표시기 첫 실행 때 개인 앱 메뉴 항목을 연결합니다. Mac은 개인 LaunchAgent와 기존 Codex Dock 항목을 연결합니다.

자세한 사용법: [Windows](docs/windows.md), [Ubuntu](docs/ubuntu.md), [macOS](docs/macos.md). Ubuntu에는 입력창이 있는 데스크톱 앱이 필요합니다.

## 표시하는 정보

- 컨텍스트 사용률과 주간 잔여율
- 최근 요청과 누적 입력의 캐시 히트 비율
- 채팅별 주간 소모 추정과 기록이 없는 미분류 사용
- 작업 시간 기준 소모 속도, 1시간 후 잔여량, 예상 고갈 시각
- 요청별 모델과 속도에 따른 credit 환산 추정, 잔액 차감 관측
- 설정 기준 자동 압축까지 남은 토큰과 세션 압축 버튼
- 최근 및 누적 API 비용 환산 추정

채팅별 소모, 비용과 긴 설명은 기본적으로 접혀 있습니다. 제목을 눌러 펼칠 수 있으며 데이터 갱신 후에도 상태가 유지됩니다. 계정 한도는 약 1분마다, 선택한 로컬 기록은 3초마다, 채팅별 비교 기록은 15초마다 확인합니다.

채팅별 소모는 계정 사용률 증가를 같은 주간 주기의 요청별 credit 환산 비중으로 배분한 추정값입니다. 계정 전체 증가량을 채팅마다 중복 표시하지 않습니다. 첫 기록 이전과 확인되지 않은 사용은 미분류로 남깁니다. 실제 한도 계산식과 정확한 채팅별 한도 %는 앱이 제공하지 않습니다.

주간 한도와 credit 잔액은 계정 공유 값입니다. 다른 세션이나 기기의 사용이 포함될 수 있습니다. 환산 비용과 credit은 실제 청구액 또는 포함된 구독 한도의 정확한 단독 사용량이 아닙니다. 계산 기준과 공식 가격 출처는 [PRICING.md](PRICING.md)에 있습니다. 데이터가 없거나 조회가 실패하면 미제공 또는 오류로 표시합니다.

## 제거

Windows는 설치된 앱에서 **Codex Composer HUD**를 제거합니다. ZIP 실행은 `Stop HUD.exe`로 종료합니다.

```bash
sudo apt remove codex-composer-hud
```

자동 연결을 끄거나 제거하면 계속 표시기를 가리키는 기존 실행 항목은 백업에서 복원합니다. 사용자가 나중에 바꾼 항목은 덮어쓰지 않습니다. 표시기만 제거하며 공식 앱, 로그인 정보, 설정과 세션 기록은 유지합니다. localhost 디버깅 포트는 공식 앱을 완전히 종료할 때 닫힙니다.

## 개발과 빌드

Node 22 이상과 Python 3.10 이상이 필요합니다. Windows 설치 파일 빌드는 Windows .NET Framework C# 컴파일러를 사용합니다.

```bash
npm test
python scripts/build_linux.py
```

Windows:

```powershell
python scripts/build_windows.py
```

Apple Silicon Mac:

```bash
python3 scripts/build_macos.py
```

산출물은 `dist/`에 생성됩니다. 빌드 스크립트는 고정된 Node 배포본을 받아 공식 SHA-256과 비교합니다. 사용자 설정, 로그인 정보, 대화 기록이나 로컬 실행 로그는 소스와 빌드에 포함하지 않습니다.

## 호환성과 검증

Windows Microsoft Store 26.928.2636.0의 실제 앱에서 UI 삽입, 채팅 전환, 접기 상태 유지, 제거와 재연결을 확인했습니다. Ubuntu 24.04 amd64 컨테이너에서 기존 패키지 설치, 제거, 런타임을 확인했습니다. 현재 로직은 Windows 및 macOS에서 32개, Linux에서 34개 테스트로 검증합니다. ARM64는 패키지 구조와 런타임 실행을 확인했습니다.

공식 Ubuntu 배포본 26.928.31416에서 입력창과 사이드바의 탐색용 속성이 Windows판과 같음을 확인했습니다. 화면용 번들은 다르며, 로그인한 Ubuntu 및 macOS 데스크톱 앱의 전체 UI 동작은 아직 검증하지 않았습니다. 내부 DOM과 메시지 형식에 의존하므로 공식 앱 업데이트 후 수정이 필요할 수 있습니다. 원격 세션의 과거 소모 기록은 제공되지 않을 수 있습니다.

## 참고 프로젝트

- [Codex Monitor](https://github.com/KevinKE93/Codex-Monitor)
- [CodexBar for Windows](https://github.com/SameRainbows/CodexBar-For-Windows)
- [Codex UI Injector](https://github.com/yijiefanren1/Codex-GPT-5.6-UI-Injector)

접근 방식을 참고해 새로 작성했으며 다른 프로젝트의 소스를 포함하지 않습니다. 프로젝트는 [MIT](LICENSE), 번들 Node 런타임은 배포본에 포함된 별도 라이선스를 따릅니다.
