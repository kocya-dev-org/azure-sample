using '../main.bicep'

param location = 'japaneast'
param staticWebAppLocation = 'eastasia'
param tags = {
  managedBy: 'bicep'
  application: 'flyingfish'
  environment: 'dev'
}
// 音声会話の中継（ADR 0013）。キーとチケットの署名鍵はワークフローが secret から渡す
param foundryRealtimeEndpoint = 'https://voice-stt-foundary.openai.azure.com/'
param foundryRealtimeModel = 'gpt-realtime-2.1-mini'
// μ-law（pcmu）が使えることを確かめたら pcmu にする（帯域が約 1/6 になる）
param realtimeAudioFormat = 'pcm'
