# Discord Music Bot Local Recovery Design

## 목적

현재 불완전한 Discord 음악 봇을 개인 테스트 서버에서 실행 가능한 상태로 복구한다. 기존 명령 이름과 사용 흐름을 유지하고, MongoDB Atlas에 재생 이력을 축적하여 향후 AI 음악 추천 기능의 입력 데이터로 사용할 수 있게 한다.

장기 현대화(`discord.js` 최신 버전, 최신 음악 소스, 추천 엔진)는 이번 복구와 분리된 후속 프로젝트로 다룬다.

## 완료 기준

- `npm test`는 Discord 토큰이나 MongoDB 연결 없이 실행되고 모든 자동 테스트가 통과한다.
- `npm start`는 필수 환경변수를 검증한 후 Discord와 MongoDB Atlas에 연결한다.
- 봇이 테스트 서버에 길드 범위 슬래시 명령을 등록한다.
- 음성 채널에 들어간 사용자가 `/play`를 실행하면 봇이 같은 채널에 참가해 곡 재생을 시작한다.
- `/pause`, `/skip`, `/stop`, `/eject`, `/q`, `/np`, `/history`, `/volume`, `/loop`, `/setup`, `/setting` 명령의 기존 이름을 유지한다.
- 곡 요청, 재생 시작, 완료, 스킵 상태가 MongoDB에 기록된다.
- 원 개발자의 MongoDB 주소, Discord 사용자 ID, 상태 알림 채널 ID에 의존하지 않는다.

## 범위

### 포함

- 누락된 `script.json`의 한국어 기본 메시지 복구
- 선택 명령 폴더가 없어도 시작 가능한 명령 로더
- 로컬 이미지 파일이 없어도 동작하는 기본 플레이어 표시
- `.env.example`, `.gitignore`, 환경변수 검증
- `MONGODB_URI` 기반 Atlas 연결
- 재생 이력 모델 및 저장 서비스
- Node 24에서 설치 및 실행 가능한 의존성 조정
- 오프라인 자동 테스트와 실제 접속을 위한 실행 문서

### 제외

- AI 추천 알고리즘 자체
- 공개 호스팅과 24시간 배포
- `discord.js` 최신 메이저 버전으로의 전면 마이그레이션
- 대시보드 또는 웹 UI
- 기존 서버 데이터의 외부 DB 마이그레이션

## 기술 방향

기존 CommonJS 모듈 구조와 `discord.js` v13 명령 API를 유지한다. 복구 단계에서는 광범위한 명령 리라이트를 피하고, 현재 Node 24에서 설치를 방해하거나 더 이상 필요하지 않은 음성·FFmpeg 의존성만 조정한다. 의존성 설치 결과가 v13 유지와 양립하지 않는 경우에만 해당 경계를 최소 범위로 올리며, 명령 이름과 사용자 흐름은 변경하지 않는다.

MongoDB 접근은 명령 및 스트림 코드에서 직접 수행하지 않고 작은 저장 서비스 뒤에 둔다. 이렇게 하면 장기 현대화에서 PostgreSQL 또는 벡터 저장소를 추가하더라도 재생 코드를 다시 작성하지 않아도 된다.

## 구성 요소

### 설정 로더

`.env`를 한 번 읽고 다음 필수 값을 검증한다.

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `DEVGUILD_ID`
- `MONGODB_URI`
- `SERVERDBDIRNAME`
- `PLAYERDBDIRNAME`

표시 문구, 색상, 플레이어 채널 이름과 이미지 URL에는 안전한 기본값을 제공한다. `YOUTUBE_COOKIE`는 선택 값으로 유지한다. 오류 메시지에는 비밀 값 자체를 출력하지 않는다.

### 명령 및 이벤트 로더

`commands/music`은 필수이며, `commands/others`와 `commands/dev`는 존재할 때만 읽는다. 모듈 하나가 잘못된 경우 파일 경로가 포함된 시작 오류를 출력한다. 개발 서버 ID가 실제 캐시에 없으면 `undefined`를 전달하지 않고 명확한 구성 오류로 종료한다.

### 메시지 리소스

코드가 참조하는 `defaultMusicCommandScript`, `searchsongScript`, `streamScript`, `settingScript`, `syncplayerScript`, `playerLeftScript`를 `script.json`에 완전한 한국어 기본값으로 제공한다. 메시지는 기능 분기용 숫자 오류 코드의 기존 배열 순서를 보존한다.

### 플레이어 표시

기본 배너 파일이 없다는 이유로 `/setup`이 실패하지 않도록 로컬 첨부 파일 의존성을 제거한다. 환경변수의 이미지 URL이 있으면 사용하고, 없으면 텍스트와 Embed만 보낸다.

### MongoDB 연결

소스에 고정된 사용자명과 클러스터 주소를 제거하고 `MONGODB_URI`만 사용한다. 연결 성공 후 Discord 로그인을 시작해 명령 처리 중 DB 버퍼링으로 무기한 대기하는 상황을 피한다. 시작 연결 실패는 프로세스를 종료하는 치명적 오류로 처리한다.

### 재생 이력

재생 한 건은 다음 필드를 가진다.

- `guildId`: Discord 서버 ID
- `userId`: 곡을 요청한 사용자 ID
- `trackKey`: 가능한 경우 플랫폼 곡 ID, 아니면 정규화된 URL
- `title`, `artist`, `url`, `source`
- `requestedAt`, `startedAt`, `endedAt`
- `status`: `requested`, `playing`, `completed`, `skipped`, `failed`
- `durationSeconds`, `playedSeconds`

사용자가 입력한 일반 메시지 본문, Discord 토큰, YouTube 쿠키는 저장하지 않는다. `guildId + userId + requestedAt`, `trackKey`, `status`에 조회용 인덱스를 둔다.

## 데이터 흐름

1. 사용자가 `/play`로 곡을 요청한다.
2. 검색 및 대기열 추가가 성공하면 저장 서비스가 `requested` 이력을 만든다.
3. 오디오 플레이어가 `Playing` 상태가 되면 동일 이력을 `playing`으로 갱신한다.
4. 자연 종료 시 `completed`, 명시적 건너뛰기 시 `skipped`, 스트림 오류 시 `failed`로 갱신한다.
5. 이력 기록 실패는 구조화된 오류 로그를 남기되 현재 재생을 중단하지 않는다.
6. Discord 또는 MongoDB의 시작 연결 실패는 봇을 반쯤 활성화하지 않고 즉시 종료한다.

## Discord 활성화 흐름

사용자는 Developer Portal에서 앱을 만든 뒤 테스트 서버에 `bot`과 `applications.commands` 범위로 설치한다. 봇에는 채널 보기, 메시지 전송, Embed/첨부, 메시지 기록 읽기, 메시지 관리, 채널 관리, 음성 채널 연결 및 말하기 권한이 필요하다.

봇 시작 시 `DEVGUILD_ID` 서버에 길드 범위 명령을 등록한다. 이 프로젝트는 Gateway 연결을 사용하므로 공개 HTTP 상호작용 엔드포인트는 필요하지 않다.

## 오류 처리

- 필수 환경변수 누락: 누락된 변수 이름만 나열하고 시작 중단
- Atlas 연결 실패: 비밀을 가린 오류와 해결 힌트를 출력하고 시작 중단
- 개발 서버 미발견: 봇 초대 여부와 `DEVGUILD_ID`를 확인하도록 안내하고 시작 중단
- 명령 모듈 로드 실패: 대상 파일 경로와 원래 오류를 출력하고 시작 중단
- 음악 검색/스트림 실패: 사용자에게 짧은 오류를 응답하고 이력을 `failed`로 기록
- 이력 저장 실패: 재생은 계속하고 서버·사용자·곡 식별자만 로그에 기록
- 고정된 외부 사용자 또는 채널로의 알림: 완전히 제거

## 테스트 전략

Node 내장 테스트 러너를 사용해 외부 서비스 없이 다음 동작을 검증한다.

- 필수 설정 누락을 정확히 보고한다.
- 선택 설정은 기본값으로 정규화한다.
- 선택 명령 폴더가 없어도 음악 명령을 로드한다.
- 잘못된 명령 모듈은 파일 경로가 포함된 오류를 낸다.
- 재생 이력 입력이 MongoDB 문서 형태로 정규화된다.
- 상태 전이가 `requested → playing → completed/skipped/failed`만 허용된다.
- 저장 실패가 스트림 제어 흐름으로 전파되지 않는다.

통합 검증은 별도로 수행한다.

- `npm install`
- `npm test`
- 비밀 값을 채운 뒤 `npm start`
- 콘솔에서 MongoDB 연결, Discord 로그인, 길드 명령 등록 확인
- 테스트 음성 채널에서 `/play`, `/pause`, `/skip`, `/stop`, `/eject` 수동 확인
- Atlas에서 이력 문서의 상태와 타임스탬프 확인

## 보안 및 개인정보

- `.env`와 `node_modules`는 Git에서 제외한다.
- `.env.example`에는 값이 없는 키와 설명만 둔다.
- 로그에 토큰, 쿠키, MongoDB URI를 출력하지 않는다.
- 추천에 필요한 최소 메타데이터만 보관한다.
- 향후 공개 운영 전에는 사용자별 기록 삭제, 보존 기간, 수집 고지 기능을 별도 설계한다.

## 장기 현대화와의 경계

후속 프로젝트는 다음을 별도 설계한다.

- 최신 `discord.js` 및 `@discordjs/voice`로 이전
- 유지보수되는 음악 추출기 또는 별도 Lavalink 계층
- 재생 이력 기반 통계 및 추천 후보 생성
- 임베딩과 벡터 검색 여부 결정
- 사용자 기록 삭제 및 추천 비활성화 기능
- 24시간 배포, 모니터링, 재시작 정책
