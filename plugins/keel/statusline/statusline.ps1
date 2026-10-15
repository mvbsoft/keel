$raw = [Console]::In.ReadToEnd()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$cwd = $null
$modelName = $null
$thinkingEnabled = $false
$currentTokens = $null
$maxTokens = 200000
$sessionCost = $null

if ($raw -and $raw.Trim() -ne "") {
    try {
        $data = $raw | ConvertFrom-Json

        if ($data.workspace -and $data.workspace.current_dir) { $cwd = $data.workspace.current_dir }
        elseif ($data.cwd) { $cwd = $data.cwd }

        if ($data.model -and $data.model.display_name) { $modelName = $data.model.display_name }

        if ($data.thinking -and $data.thinking.enabled -eq $true) { $thinkingEnabled = $true }

        if ($data.cost -and $data.cost.total_cost_usd) { $sessionCost = [double]$data.cost.total_cost_usd }

        if ($data.context_window) {
            if ($data.context_window.total_input_tokens) { $currentTokens = [int]$data.context_window.total_input_tokens }
            if ($data.context_window.context_window_size) { $maxTokens    = [int]$data.context_window.context_window_size }
        }
    } catch {}
}

if (-not $cwd) { $cwd = (Get-Location).Path }

# Git branch
$branch = $null
try {
    $inside = (git -C $cwd rev-parse --is-inside-work-tree 2>$null)
    if ($LASTEXITCODE -eq 0 -and $inside -and $inside.Trim() -eq "true") {
        $b = (git -C $cwd rev-parse --abbrev-ref HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $b) { $branch = $b.Trim() }
    }
} catch {}

function Format-Tokens($n) {
    if ($n -ge 1000000) { return "$([Math]::Round($n / 1000000.0, 1))M" }
    if ($n -ge 1000)    { return "$([Math]::Round($n / 1000.0, 1))K" }
    return [string]$n
}

function Format-Bar($pct) {
    $filled = [Math]::Min([Math]::Floor($pct / 10), 10)
    return ([string][char]0x25B0) * $filled + ([string][char]0x25B1) * (10 - $filled)
}

$parts = @()

if ($cwd) {
    $folder = [System.IO.Path]::GetFileName($cwd.TrimEnd('/\'))
    if (-not $folder) { $folder = $cwd }
    $parts += [System.Char]::ConvertFromUtf32(0x1F4C1) + " $folder"
}

if ($branch) {
    $herb = [System.Char]::ConvertFromUtf32(0x1F33F)
    $parts += "$herb $branch"
}

if ($modelName) {
    $robot = [System.Char]::ConvertFromUtf32(0x1F916)
    $modelPart = "$robot $modelName"
    if ($thinkingEnabled) {
        $brain = [System.Char]::ConvertFromUtf32(0x1F9E0)
        $modelPart += " $brain"
    }
    $curStr = if ($null -ne $currentTokens) { Format-Tokens $currentTokens } else { "-" }
    $modelPart += " ({0}/{1})" -f $curStr, (Format-Tokens $maxTokens)
    $parts += $modelPart
}

if ($data -and $data.rate_limits) {
    $rl    = $data.rate_limits
    $chart = [System.Char]::ConvertFromUtf32(0x1F4CA)
    $rateParts = @()

    # Rounded down like statusline.sh: 99.6% is not full yet.
    if ($rl.five_hour) {
        $pct = [int][Math]::Floor([double]$rl.five_hour.used_percentage)
        $rateParts += "$chart 5h ($pct%) $(Format-Bar $pct)"
    }
    if ($rl.seven_day) {
        $pct = [int][Math]::Floor([double]$rl.seven_day.used_percentage)
        $rateParts += "$chart 1w ($pct%) $(Format-Bar $pct)"
    }

    if ($rateParts.Count -gt 0) {
        $rateLine = $rateParts -join "  "
        if ($rl.five_hour -and [double]$rl.five_hour.used_percentage -ge 100) {
            $lightning = [System.Char]::ConvertFromUtf32(0x1F4B0)
            $costStr = if ($null -ne $sessionCost) { " `$$($sessionCost.ToString('0.00', [System.Globalization.CultureInfo]::InvariantCulture))" } else { "" }
            $rateLine = "$lightning$costStr  $rateLine"
        }
        $parts += $rateLine
    }
}

if ($parts.Count -gt 0) {
    Write-Host ($parts -join " | ")
}
