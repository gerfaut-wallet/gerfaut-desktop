# Pester tests for release-checks.ps1, on throwaway git repositories
# under TestDrive: no key, no network, no GitHub. Needs Pester 5 or
# later (Install-Module Pester -Scope CurrentUser; Windows ships 3.4):
#
#   Invoke-Pester scripts

BeforeAll {
    . (Join-Path $PSScriptRoot "release-checks.ps1")

    function Invoke-Git {
        git @args
        if ($LASTEXITCODE -ne 0) { throw "git $args failed" }
    }

    # A bare repository standing in for GitHub, reached as origin through
    # a file:// URL, a clone the release is tagged from, and the clone
    # that signs, which has fetched nothing yet but main.
    function New-Repositories([string]$Slug) {
        $base = Join-Path $TestDrive ([guid]::NewGuid())
        $bare = Join-Path $base "$Slug.git"
        Invoke-Git init --quiet --bare --initial-branch=main $bare
        $url = "file:///" + ($bare -replace '\\', '/').TrimStart('/')
        $author = Join-Path $base "author"
        Invoke-Git clone --quiet $url $author 2>$null
        Invoke-Git -C $author commit --quiet --allow-empty -m one
        Invoke-Git -C $author push --quiet origin main 2>$null
        $signer = Join-Path $base "signer"
        Invoke-Git clone --quiet --no-tags $url $signer 2>$null
        return @{ Bare = $bare; Url = $url; Author = $author; Signer = $signer }
    }

    function Get-Head([string]$Dir) { git -C $Dir rev-parse HEAD }
}

Describe "Assert-OriginUrl" {
    It "accepts the repository on github.com: <url>" -ForEach @(
        @{ url = "https://github.com/gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "https://github.com/gerfaut-wallet/gerfaut-desktop" }
        @{ url = "git@github.com:gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "ssh://git@github.com/gerfaut-wallet/gerfaut-desktop.git" }
    ) {
        { Assert-OriginUrl -Url $url -Slug "gerfaut-wallet/gerfaut-desktop" } | Should -Not -Throw
    }

    It "refuses anything else: <url>" -ForEach @(
        @{ url = "https://github.com/gerfaut-wallet/gerfaut-mobile.git" }
        @{ url = "https://github.com/someone/gerfaut-desktop.git" }
        @{ url = "https://github.com/gerfaut-wallet/gerfaut-desktop-fork.git" }
        @{ url = "https://gitlab.com/gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "https://github.com.example.org/gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "https://mirror.example.org/github.com/gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "https://GitHub.com/gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "http://github.com/gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "git@mirror.example.org:gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "file:///srv/git/gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "/srv/git/gerfaut-wallet/gerfaut-desktop.git" }
        @{ url = "" }
    ) {
        { Assert-OriginUrl -Url $url -Slug "gerfaut-wallet/gerfaut-desktop" } | Should -Throw "origin is *, not github.com/gerfaut-wallet/gerfaut-desktop"
    }

    It "accepts the test origin it is given, and only that one" {
        { Assert-OriginUrl -Url "file:///tmp/a/gerfaut-wallet/gerfaut-desktop.git" -Slug "gerfaut-wallet/gerfaut-desktop" -TestOrigin "file:///tmp/a/gerfaut-wallet/gerfaut-desktop.git" 3>$null } | Should -Not -Throw
        { Assert-OriginUrl -Url "file:///tmp/b/gerfaut-wallet/gerfaut-desktop.git" -Slug "gerfaut-wallet/gerfaut-desktop" -TestOrigin "file:///tmp/a/gerfaut-wallet/gerfaut-desktop.git" } | Should -Throw "*not the test origin*"
    }

    It "refuses a test origin set on a clone of GitHub" {
        { Assert-OriginUrl -Url "https://github.com/gerfaut-wallet/gerfaut-desktop.git" -Slug "gerfaut-wallet/gerfaut-desktop" -TestOrigin "file:///tmp/a/gerfaut-wallet/gerfaut-desktop.git" } | Should -Throw "*not the test origin*"
    }

    It "refuses a test origin that is not a file:// URL" {
        { Assert-OriginUrl -Url "https://mirror.example.org/gerfaut-wallet/gerfaut-desktop.git" -Slug "gerfaut-wallet/gerfaut-desktop" -TestOrigin "https://mirror.example.org/gerfaut-wallet/gerfaut-desktop.git" } | Should -Throw "*must be a file:// URL*"
    }
}

Describe "Get-ReleaseCommit" {
    BeforeAll {
        # The user's own settings (hooks, signed commits) stay out.
        $savedGlobal = $env:GIT_CONFIG_GLOBAL
        $savedNoSystem = $env:GIT_CONFIG_NOSYSTEM
        $env:GIT_CONFIG_GLOBAL = Join-Path $TestDrive "gitconfig"
        $env:GIT_CONFIG_NOSYSTEM = "1"
        Set-Content -LiteralPath $env:GIT_CONFIG_GLOBAL -Value "[user]`n`tname = Test`n`temail = test@example.invalid"
        $slug = "gerfaut-wallet/gerfaut-desktop"
    }
    AfterAll {
        $env:GIT_CONFIG_GLOBAL = $savedGlobal
        $env:GIT_CONFIG_NOSYSTEM = $savedNoSystem
    }
    BeforeEach {
        $repos = New-Repositories $slug
        $author = $repos.Author
        $signer = $repos.Signer
        $url = $repos.Url
        $script:github = $repos.Bare
        # GitHub's API, answered from the bare repository:
        # gh api --hostname github.com repos/<slug>/commits/<ref> --jq .sha
        Mock gh {
            $path = @($args | Where-Object { $_ -like "repos/*/commits/*" })[0]
            $sha = git -C $script:github rev-parse --verify --quiet (($path -replace '^repos/[^/]+/[^/]+/commits/', '') + '^{commit}')
            $global:LASTEXITCODE = if ($sha) { 0 } else { 1 }
            $sha
        }
    }

    It "returns the commit a tag on main names" {
        Invoke-Git -C $author tag v0.1.0
        Invoke-Git -C $author push --quiet origin v0.1.0 2>$null
        Invoke-Git -C $signer fetch --quiet origin tag v0.1.0
        Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug -TestOrigin $url 3>$null | Should -Be (Get-Head $author)
        Should -Invoke gh -Times 1 -Exactly -ParameterFilter { "$args" -eq "api --hostname github.com repos/$slug/commits/refs/tags/v0.1.0 --jq .sha" }
        Should -Invoke gh -Times 1 -Exactly -ParameterFilter { "$args" -eq "api --hostname github.com repos/$slug/commits/refs/heads/main --jq .sha" }
    }

    It "returns the commit, not the tag object, for an annotated tag" {
        Invoke-Git -C $author tag -a -m "Gerfaut 0.1.0" v0.1.0
        Invoke-Git -C $author push --quiet origin v0.1.0 2>$null
        Invoke-Git -C $signer fetch --quiet origin tag v0.1.0
        Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug -TestOrigin $url 3>$null | Should -Be (Get-Head $author)
    }

    It "fetches main to find a commit this clone has not seen on it" {
        Invoke-Git -C $author commit --quiet --allow-empty -m two
        Invoke-Git -C $author tag v0.1.0
        $tagged = Get-Head $author
        Invoke-Git -C $author commit --quiet --allow-empty -m three
        Invoke-Git -C $author push --quiet origin main v0.1.0 2>$null
        Invoke-Git -C $signer fetch --quiet origin tag v0.1.0
        git -C $signer merge-base --is-ancestor $tagged origin/main
        $LASTEXITCODE | Should -Be 1
        Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug -TestOrigin $url 3>$null | Should -Be $tagged
    }

    It "refuses an origin that is not GitHub" {
        Invoke-Git -C $author tag v0.1.0
        Invoke-Git -C $author push --quiet origin v0.1.0 2>$null
        Invoke-Git -C $signer fetch --quiet origin tag v0.1.0
        { Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug } | Should -Throw "origin is file:///*, not github.com/$slug"
        Should -Invoke gh -Times 0 -Exactly
    }

    It "refuses a tag that moved on GitHub after this clone fetched it" {
        Invoke-Git -C $author tag v0.1.0
        Invoke-Git -C $author push --quiet origin v0.1.0 2>$null
        Invoke-Git -C $signer fetch --quiet origin tag v0.1.0
        Invoke-Git -C $author commit --quiet --allow-empty -m two
        Invoke-Git -C $author tag --force v0.1.0 2>$null
        Invoke-Git -C $author push --quiet --force origin main v0.1.0 2>$null
        { Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug -TestOrigin $url 3>$null } | Should -Throw "*on GitHub: the tag moved*"
    }

    It "takes the tag from GitHub, not from origin" {
        Invoke-Git -C $author tag v0.1.0
        Invoke-Git -C $author push --quiet origin v0.1.0 2>$null
        Invoke-Git -C $signer fetch --quiet origin tag v0.1.0
        Mock gh { $global:LASTEXITCODE = 0; "2" * 40 } -ParameterFilter { "$args" -like "*/commits/refs/tags/*" }
        { Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug -TestOrigin $url 3>$null } | Should -Throw "*but 2222222222222222222222222222222222222222 on GitHub: the tag moved*"
    }

    It "refuses a main that origin and GitHub see differently" {
        Invoke-Git -C $author tag v0.1.0
        Invoke-Git -C $author push --quiet origin v0.1.0 2>$null
        Invoke-Git -C $signer fetch --quiet origin tag v0.1.0
        Mock gh { $global:LASTEXITCODE = 0; "3" * 40 } -ParameterFilter { "$args" -like "*/commits/refs/heads/main*" }
        { Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug -TestOrigin $url 3>$null } | Should -Throw "*as fetched from origin but 3333333333333333333333333333333333333333 on GitHub*"
    }

    It "refuses a tag that names a commit outside main" {
        Invoke-Git -C $author switch --quiet --create side
        Invoke-Git -C $author commit --quiet --allow-empty -m side
        Invoke-Git -C $author tag v0.1.0
        Invoke-Git -C $author push --quiet origin v0.1.0 2>$null
        Invoke-Git -C $signer fetch --quiet origin tag v0.1.0
        { Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug -TestOrigin $url 3>$null } | Should -Throw "*not on the main branch*"
    }

    It "refuses a tag this clone does not have" {
        Invoke-Git -C $author tag v0.1.0
        Invoke-Git -C $author push --quiet origin v0.1.0 2>$null
        { Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug -TestOrigin $url 3>$null } | Should -Throw "*no tag v0.1.0 in this clone*"
    }

    It "refuses a tag GitHub does not have" {
        Invoke-Git -C $signer tag v0.1.0
        { Get-ReleaseCommit -RepoDir $signer -Tag v0.1.0 -Slug $slug -TestOrigin $url 3>$null } | Should -Throw "*GitHub gave no commit for the tag v0.1.0*"
    }
}

Describe "Find-ReleaseRun" {
    BeforeAll {
        $commit = "1" * 40
        $other = "2" * 40
    }

    It "returns the run at the commit the tag names" {
        Mock gh {
            $global:LASTEXITCODE = 0
            "[{`"databaseId`":11,`"headSha`":`"$other`"},{`"databaseId`":12,`"headSha`":`"$commit`"}]"
        }
        Find-ReleaseRun -Slug gerfaut-wallet/gerfaut-desktop -Tag v0.1.0 -Commit $commit | Should -Be 12
        # A list such as databaseId,headSha reaches the mock as an array
        # and gh as one argument.
        Should -Invoke gh -Times 1 -Exactly -ParameterFilter {
            ($args | ForEach-Object { $_ -join "," }) -join " " -eq
                "run list --repo gerfaut-wallet/gerfaut-desktop --workflow release.yml --event push --branch v0.1.0 --status success --json databaseId,headSha"
        }
    }

    It "refuses when no successful run of the push is at that commit" {
        Mock gh {
            $global:LASTEXITCODE = 0
            "[{`"databaseId`":11,`"headSha`":`"$other`"}]"
        }
        { Find-ReleaseRun -Slug gerfaut-wallet/gerfaut-desktop -Tag v0.1.0 -Commit $commit } | Should -Throw "*no successful Release run*"
    }

    It "refuses when there is no run at all" {
        Mock gh { $global:LASTEXITCODE = 0; "[]" }
        { Find-ReleaseRun -Slug gerfaut-wallet/gerfaut-desktop -Tag v0.1.0 -Commit $commit } | Should -Throw "*no successful Release run*"
    }
}

Describe "Assert-ExactNames" {
    BeforeAll {
        $want = "a.deb", "b.exe", "c.zip"
    }

    It "accepts the same names in another order" {
        { Assert-ExactNames -Have "c.zip", "a.deb", "b.exe" -Want $want -What "draft" } | Should -Not -Throw
    }

    It "refuses a file too many" {
        { Assert-ExactNames -Have "a.deb", "b.exe", "c.zip", "d.msi" -Want $want -What "draft" } | Should -Throw "*unexpected: d.msi*"
    }

    It "refuses a missing file" {
        { Assert-ExactNames -Have "a.deb", "c.zip" -Want $want -What "draft" } | Should -Throw "*missing: b.exe*"
    }

    It "refuses a name given twice" {
        { Assert-ExactNames -Have "a.deb", "b.exe", "c.zip", "c.zip" -Want $want -What "list" } | Should -Throw "*more than once: c.zip*"
    }

    It "refuses a name that differs only in case" {
        { Assert-ExactNames -Have "A.deb", "b.exe", "c.zip" -Want $want -What "draft" } | Should -Throw "*unexpected: A.deb*"
    }

    It "refuses an empty draft" {
        { Assert-ExactNames -Have @() -Want $want -What "draft" } | Should -Throw "*missing: a.deb*"
    }
}
