Add-Type -AssemblyName System.Speech
$wav = Join-Path $env:TEMP 'relay-test-utterance.wav'
$pcm = Join-Path $env:TEMP 'relay-test-utterance.pcm'
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synthesizer.Rate = 0
$synthesizer.SetOutputToWaveFile($wav, (New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)))
$synthesizer.Speak('Hello team, please give me a short research briefing about Amazon Bedrock.')
$synthesizer.Dispose()
$wave = [System.IO.File]::ReadAllBytes($wav)
$offset = 0
for ($index = 0; $index -lt $wave.Length - 4; $index++) {
  if ($wave[$index] -eq 100 -and $wave[$index + 1] -eq 97 -and $wave[$index + 2] -eq 116 -and $wave[$index + 3] -eq 97) {
    $size = [BitConverter]::ToInt32($wave, $index + 4)
    $offset = $index + 8
    [System.IO.File]::WriteAllBytes($pcm, $wave[$offset..($offset + $size - 1)])
    break
  }
}
Write-Output $pcm
