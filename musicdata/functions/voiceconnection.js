const { entersState, VoiceConnectionStatus } = require('@discordjs/voice');

async function waitForVoiceReady(connection, timeout = 20000) {
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, timeout);
  } catch (cause) {
    const status = connection.state.status;
    if (status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    throw new Error(`음성 연결 준비에 실패했습니다 (상태: ${status}). 연결·말하기 권한과 네트워크를 확인해 주세요.`, { cause });
  }
}

module.exports = { waitForVoiceReady };
