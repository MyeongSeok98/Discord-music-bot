# YouTube 재생

YouTube 영상 URL 정보 조회와 오디오 추출은 `youtube-dl-exec`에 포함된
`yt-dlp`를 사용합니다. 기존 명령어, 대기열 데이터 형식은 유지합니다.

## 설치와 실행

```powershell
npm install
npm start
```

설치 과정에서 운영체제에 맞는 yt-dlp 실행 파일을 받습니다. npm이 이
패키지의 설치 스크립트를 차단하는 환경에서는 `youtube-dl-exec`의 설치
스크립트를 검토하고 허용해야 합니다. 실행 시 Node.js를 JavaScript
런타임으로 지정하며, 전역 Python이나 yt-dlp 설치는 요구하지 않습니다.

기본 경로는 공개 영상에 대해 로그인 없이 동작합니다. 기존
`YOUTUBE_COOKIE` 문자열은 새 추출기에 전달하지 않습니다. 로그인이나
지역 제한이 있는 영상의 지원을 보장하지 않습니다. 실패하면 터미널의
`youtube-url error` 또는 스트림 오류를 확인하세요.

자동 재생의 관련 영상 목록은 기존 `play-dl`로 구하고, 후보의 정보는
yt-dlp로 확인합니다. 최근 이력, 금지어와 길이 제한을 적용하며 최대
10개의 후보를 검사합니다. 제목 검색과 플레이리스트 목록 조회는 기존
`ytsr`, `ytpl` 경로를 유지하므로 YouTube 변경 시 별도 점검이 필요합니다.

YouTube 변경으로 추출기가 다시 실패할 경우, 공식 yt-dlp 업데이트를
다음 명령으로 적용할 수 있습니다. 이 명령은 설치된 바이너리를 변경하며
버전은 package-lock.json과 별도로 관리됩니다.

```powershell
node -e "require('youtube-dl-exec').update().then(()=>console.log('yt-dlp updated')).catch(e=>{console.error(e.message);process.exitCode=1})"
```

자동 회귀 테스트는 Discord 로그인이나 DB 연결 없이 `npm test`로 실행합니다.
실제 서버에서의 소리 출력, 스킵/정지 및 연결 해제는 Discord에서 확인해야 합니다.

## 음성 연결 점검

음성 패키지는 DAVE 지원 라이브러리가 포함된 `@discordjs/voice@0.19.2`를
사용합니다. 봇이 음성 채널에 표시되는 것과 음성 연결 준비 완료는 다르므로,
Ready 상태를 최대 20초 기다린 다음 곡을 추가합니다. 연결 실패 시 채널에
안내하고 터미널에 원래 오류를 남깁니다.

소리가 나지 않으면 `/play` 이후의 `[voice 서버ID]`와 `[audio 서버ID]`
로그를 확인하세요. 정상 경로는 음성 `ready`와 오디오 `playing`입니다.
서버에서 봇이 음소거됐는지, 채널의 말하기 권한, 청취자 쪽 사용자 음량도
확인해야 합니다.
