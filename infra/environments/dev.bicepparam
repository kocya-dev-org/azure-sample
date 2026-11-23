using '../main.bicep'

param location = 'japaneast'
param staticWebAppLocation = 'eastasia'
param tags = {
  managedBy: 'bicep'
  application: 'flyingfish'
  environment: 'dev'
}
// 音声会話の中継（ADR 0013）。キーとチケットの署名鍵はワークフローが secret から渡す
param relayLocation = 'japanwest'
param foundryRealtimeEndpoint = 'https://voice-stt-foundary.openai.azure.com/'
// 全二重の音声モデル GPT-Live（ADR 0014）
param foundryLiveModel = 'gpt-live-1'
