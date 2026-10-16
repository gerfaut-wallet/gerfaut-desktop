# The checks scripts/sign-release.ps1 runs before it signs anything.
# Dot-sourced: this file only defines functions. They live apart so that
# release-checks.Tests.ps1 can run them on throwaway repositories, with
# no key and no network:
#
#   Invoke-Pester scripts

# Throws unless origin is the repository on github.com, over https or
# ssh. The URL is git's own, insteadOf rewrites applied, so a rule that
# sends github.com to a mirror is caught too.
#
# $TestOrigin is for tests only: the tests and the dry run set it,
# through GERFAUT_SIGN_TEST_ORIGIN for the latter. It names one file://
# URL that origin may be instead of github.com, and nothing else: set by
# mistake on a clone of GitHub, it fails the run.
function Assert-OriginUrl {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Url,
        [Parameter(Mandatory)][string]$Slug,
        [string]$TestOrigin
    )
    if ($TestOrigin) {
        if ($TestOrigin -notmatch '^file://') { throw "GERFAUT_SIGN_TEST_ORIGIN must be a file:// URL, not $TestOrigin" }
        if ($Url -cne $TestOrigin) { throw "origin is $Url, not the test origin $TestOrigin" }
        Write-Warning "test run: origin is $Url, not github.com"
        return
    }
    $github = "^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)$([regex]::Escape($Slug))(\.git)?/?$"
    if ($Url -cnotmatch $github) { throw "origin is $Url, not github.com/$Slug" }
}

# The commit a release tag names, once this clone and GitHub agree on
# it: the tag names the same commit here and on GitHub, and main, as
# fetched from origin and as GitHub has it, holds that commit. GitHub's
# side comes from its API, never from origin alone. A tag moved after
# the push, or one that names a commit main never took in, stops the
# signature here. GitHub protects `v*` tags as well; this is the second
# barrier, the one on the machine that signs.
function Get-ReleaseCommit {
    param(
        [Parameter(Mandatory)][string]$RepoDir,
        [Parameter(Mandatory)][string]$Tag,
        [Parameter(Mandatory)][string]$Slug,
        [string]$TestOrigin
    )
    $url = git -C $RepoDir remote get-url origin 2>$null
    if ($LASTEXITCODE -ne 0) { throw "$RepoDir has no remote named origin" }
    Assert-OriginUrl -Url $url -Slug $Slug -TestOrigin $TestOrigin

    # Each answer must be one commit id and nothing else: -join turns a
    # second line into a mismatch rather than a list to filter.
    $local = (git -C $RepoDir rev-parse --verify --quiet "refs/tags/${Tag}^{commit}") -join "`n"
    if ($LASTEXITCODE -ne 0 -or $local -notmatch '^[0-9a-f]{40}$') {
        throw "no tag $Tag in this clone: fetch it (git fetch origin tag $Tag), check that it names the commit you meant to release, then run this again"
    }
    # The commits endpoint peels an annotated tag down to its commit.
    $published = (gh api --hostname github.com "repos/$Slug/commits/refs/tags/$Tag" --jq .sha) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $published -notmatch '^[0-9a-f]{40}$') { throw "GitHub gave no commit for the tag $Tag of $Slug" }
    if ($published -ne $local) {
        throw "$Tag names $local in this clone but $published on GitHub: the tag moved"
    }

    git -C $RepoDir fetch --quiet --no-tags origin "+refs/heads/main:refs/remotes/origin/main"
    if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed" }
    $fetched = (git -C $RepoDir rev-parse --verify --quiet "refs/remotes/origin/main^{commit}") -join "`n"
    $main = (gh api --hostname github.com "repos/$Slug/commits/refs/heads/main" --jq .sha) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $main -notmatch '^[0-9a-f]{40}$') { throw "GitHub gave no commit for the main branch of $Slug" }
    if ($fetched -ne $main) {
        throw "main is $fetched as fetched from origin but $main on GitHub: run this again if main just moved"
    }
    # Against the commit just checked, with no replace ref of this clone
    # rewriting history on the way.
    git -C $RepoDir --no-replace-objects merge-base --is-ancestor $local $main
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
