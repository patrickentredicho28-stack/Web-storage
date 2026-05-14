$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ScriptDir

$nodeCandidates = @(
  "C:\Users\PC\AppData\Local\OpenAI\Codex\bin\node.exe",
  "C:\Users\PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

$node = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $node) {
  throw "Node executable not found."
}

& $node ".\server.js" *> ".\server.runtime.log"
