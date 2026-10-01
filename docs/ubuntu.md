# Codex Composer HUD for Ubuntu 24.04

Ubuntu 24.04 데스크톱용 사용량 표시기입니다. 공식 Linux ChatGPT 앱의 Codex 입력창에 Windows판과 같은 사용량 UI를 붙입니다. Node 런타임은 패키지에 포함되어 있습니다.

## 먼저 확인

공식 ChatGPT Linux 앱을 설치하고 로그인해야 합니다. 이 패키지는 공식 앱을 포함하지 않습니다. [공식 Ubuntu 설치 안내](https://learn.chatgpt.com/docs/linux/linux-app)를 참고하세요. CLI만 있는 SSH 서버에는 입력창 UI가 없으므로 데스크톱이 필요합니다.

`uname -m`이 `x86_64`이면 `amd64.deb`, `aarch64` 또는 `arm64`이면 `arm64.deb`를 선택합니다.

## 설치와 실행

```bash
sudo apt install ./codex-composer-hud_1.5.0-1_amd64.deb
```

ARM64 컴퓨터는 파일명만 `codex-composer-hud_1.5.0-1_arm64.deb`로 바꿉니다. 앱 메뉴에서 **Codex Composer HUD**를 실행합니다. 터미널에서는 다음을 사용합니다.

```bash
codex-composer-hud
```

기존 일반 앱이 실행 중이면 작업을 마친 뒤 완전히 종료합니다. 표시기가 사용량 버튼을 붙인 앱을 엽니다. 이전에 표시기로 실행한 앱은 종료하지 않고 다시 연결합니다. GUI 실행에는 sudo를 사용하지 않습니다.

공식 앱의 명령 이름은 `chatgpt`입니다. 다른 위치의 호환 앱이라면 실행 파일을 직접 지정할 수 있습니다.

```bash
codex-composer-hud --app /absolute/path/to/ChatGPT
codex-composer-hud --diagnose
codex-composer-hud --status
codex-composer-hud --stop
```

## 기능과 기준

- 모델 선택기 왼쪽에 컨텍스트 사용률과 주간 잔여율.
- 최근 요청과 세션 누적 캐시 히트 비율.
- 이 채팅의 주간 전체 한도 소모 추정, 작업 시간 기준 소모 속도, 1시간 후 계정 잔여량과 예상 고갈 시각.
- credit 환산 추정과 계정 잔액 차감의 관측값. 속도 기록이 없으면 요율 범위로 표시.
- 자동 압축까지 남은 토큰의 설정 기준 추정과 작업 종료 후 사용할 수 있는 압축 버튼.
- 데이터 미제공, 표본 부족, 조회 실패를 구분합니다.
- 세션 소모와 비용은 기본적으로 접힌 토글바이며, 긴 산정 설명도 별도로 접고 펼칠 수 있습니다.

계정 한도와 잔액은 다른 세션이나 기기와 공유됩니다. 이 세션의 정확한 단독 청구량으로 해석하지 않습니다. 가격과 계산의 상세 기준은 `PRICING.md`에 있습니다. 기록은 `$CODEX_HOME/sessions` 또는 기본 `~/.codex/sessions`에서 읽습니다.

## 제거

```bash
sudo apt remove codex-composer-hud
```

패키지 제거와 업그레이드는 이 표시기만 종료하며 공식 앱과 세션 기록은 유지합니다. 사용자 상태와 대화 내용 없는 로그는 `${XDG_STATE_HOME:-~/.local/state}/CodexComposerHUD`에 남습니다. 자동 시작 등록이나 로그인 정보 수정은 하지 않습니다.

## 검증 범위

Ubuntu 24.04 amd64 컨테이너에서 패키지 설치와 제거, 런타임, 20개 테스트를 확인했습니다. ARM64는 패키지 구조와 런타임 실행을 확인했습니다. 실제 Ubuntu 데스크톱에서 로그인한 공식 앱에 UI를 주입하는 전체 과정은 검증하지 못했습니다. 공식 앱의 내부 DOM과 메시지 형식에 의존하므로 Linux 프리뷰 업데이트 후에는 조정이 필요할 수 있습니다.

공식 Linux 배포본 26.928.31416의 화면용 번들을 확인했습니다. 입력창과 사이드바 탐색 속성은 Windows판과 같지만, 실제 로그인 화면의 배치까지 검증한 것은 아닙니다.
