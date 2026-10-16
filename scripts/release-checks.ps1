# The checks scripts/sign-release.ps1 runs before it signs anything.
# Dot-sourced: this file only defines functions. They live apart so that
# release-checks.Tests.ps1 can run them on throwaway repositories, with
# no key and no network:
#
#   Invoke-Pester scripts

# The commit a release tag names, once the tag in this clone, the tag on
# GitHub and main on GitHub agree: the tag names the same commit in both
# places, and main holds that commit. A tag moved after the push, or one
# that names a commit main never took in, stops the signature here.
# GitHub protects `v*` tags as well; this is the second barrier, the one
# on the machine that signs.
function Get-ReleaseCommit {
    param(
        [Parameter(Mandatory)][string]$RepoDir,
        [Parameter(Mandatory)][string]$Tag,
        [Parameter(Mandatory)][string]$Slug,
        [string]$Remote = "origin"
    )
    $url = git -C $RepoDir remote get-url $Remote 2>$null
    if ($LASTEXITCODE -ne 0) { throw "$RepoDir has no remote named $Remote" }
    if ($url -notmatch "[/:]$([regex]::Escape($Slug))(\.git)?/?$") {
        throw "$Remote is $url, not $Slug"
    }

    $local = git -C $RepoDir rev-parse --verify --quiet "refs/tags/${Tag}^{commit}"
    if ($LASTEXITCODE -ne 0 -or $local -notmatch '^[0-9a-f]{40}$') {
        throw "no tag $Tag in this clone: fetch it (git fetch $Remote tag $Tag), check that it names the commit you meant to release, then run this again"
    }

    # An annotated tag is listed twice: the tag object, then the commit
    # it points to, under the same name followed by ^{}.
    $listed = @{}
    foreach ($line in @(git -C $RepoDir ls-remote $Remote "refs/tags/$Tag" "refs/tags/${Tag}^{}")) {
        $sha, $ref = $line -split "`t", 2
        $listed[$ref] = $sha
    }
    if ($LASTEXITCODE -ne 0) { throw "git ls-remote $Remote failed" }
    if (-not $listed.ContainsKey("refs/tags/$Tag")) { throw "$Slug has no tag $Tag" }
    $published = if ($listed.ContainsKey("refs/tags/${Tag}^{}")) { $listed["refs/tags/${Tag}^{}"] } else { $listed["refs/tags/$Tag"] }
    if ($published -ne $local) {
        throw "$Tag names $local in this clone but $published on ${Slug}: the tag moved"
    }

    git -C $RepoDir fetch --quiet --no-tags $Remote "+refs/heads/main:refs/remotes/$Remote/main"
    if ($LASTEXITCODE -ne 0) { throw "git fetch $Remote main failed" }
    git -C $RepoDir merge-base --is-ancestor $local "refs/remotes/$Remote/main"
    switch ($LASTEXITCODE) {
        0 { return $local }
        1 { throw "$Tag names $local, which is not on the main branch of $Slug" }
        default { throw "git merge-base failed on $local" }
    }
}

# The id of the successful run of the Release workflow that the push of
# the tag started, at the commit the tag names. Anyone who can write to
# the repository can change a draft, not the artifacts of a finished
# run, so these are what the draft is held against.
function Find-ReleaseRun {
    param(
        [Parameter(Mandatory)][string]$Slug,
        [Parameter(Mandatory)][string]$Tag,
        [Parameter(Mandatory)][string]$Commit
    )
    $runs = gh run list --repo $Slug --workflow release.yml --event push --branch $Tag --status success --json databaseId,headSha
    if ($LASTEXITCODE -ne 0) { throw "gh run list failed" }
    $run = @(($runs -join "`n") | ConvertFrom-Json | Where-Object { $_.headSha -eq $Commit })[0]
    if (-not $run) { throw "no successful Release run for the push of $Tag at $Commit" }
    return $run.databaseId
}

# Throws unless $Have holds the names in $Want, each once, and nothing
# else; the message lists what is missing, unexpected or doubled.
function Assert-ExactNames {
    param(
        [AllowEmptyCollection()][string[]]$Have,
        [Parameter(Mandatory)][string[]]$Want,
        [Parameter(Mandatory)][string]$What
    )
    $problems = @(
        $Want | Where-Object { $_ -cnotin $Have } | ForEach-Object { "missing: $_" }
        $Have | Where-Object { $_ -cnotin $Want } | ForEach-Object { "unexpected: $_" }
        $Have | Group-Object -CaseSensitive | Where-Object Count -gt 1 | ForEach-Object { "more than once: $($_.Name)" }
    )
    if ($problems) { throw "$What`n  $($problems -join "`n  ")" }
}
