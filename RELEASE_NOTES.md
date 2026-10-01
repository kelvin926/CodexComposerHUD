Codex Composer HUD v1.6.0입니다.

- 새 앱 아이콘을 Windows 실행 파일과 설치 화면, Ubuntu 앱 메뉴, Apple Silicon Mac 앱에 추가
- 로그인 시 조용히 대기하고 연결된 Codex 실행 항목에서 자동으로 UI 적용
- Windows의 기존 개인 Codex 바로가기, Ubuntu 개인 앱 메뉴, Mac Dock 항목을 백업 후 연결
- 연결을 끄거나 제거할 때 계속 표시기에 연결된 항목만 복원
- 실행 중인 공식 앱은 강제로 종료하지 않으며 공식 앱 파일을 수정하지 않음
- GitHub의 인증된 빌드 서명 및 검증 번들 추가

빌드 서명은 Windows Authenticode 또는 Apple Developer ID 서명과 다릅니다. 이 두 공인 인증서는 아직 없으므로 운영체제 경고를 없애는 서명은 완료되지 않았습니다. 무료 Windows 서명 신청은 별도 심사와 신청자의 정보 및 동의가 필요합니다.

앱을 직접 실행하거나 연결되지 않은 실행 경로에는 자동 적용이 보장되지 않습니다. Ubuntu와 macOS의 로그인한 실제 GUI 전체 동작은 아직 미검증입니다.
