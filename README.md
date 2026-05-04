
..an "official" test-adapter for [pUnit](https://pypi.org/project/pUnit/), a modernized Python unit-test framework inspired by `xUnit`.

## Requirements

In your Python workspace you should install [`pUnit>=1.3.7`](https://pypi.org/project/pUnit/) as a development dependency, preferably within a virtual env.

## Contributing

Compared to any other project of mine absolutely this could use a lot of TLC, I will gladly authorize anyone that wants to help improve it as long as they can gpg sign their commits and do basic regression testing (or, even better, implement some unit tests ... something I skipped on this since I have much larger projects I need to be working on.)

### Development

For debugging the extension you will need to edit the included debug config to point at a valid Python project that has `pUnit` installed.

### TODO

- modularize the code instead of the wall of text it is right now.
- add unit tests to verify basic functionality, current test effort has been entirely manual (and dog fooding.)
- setup workflow for build, test, package and updating releases.

## LTS, Future State, etc

This extension follows typical SEMVER, major-version ticks will only occur when there is a breaking change.

Every effort will be made to maintain backward compatibility with all versions of pUnit.

## Contact

You can reach me on [Discord](https://discordapp.com/users/307684202080501761) or [open an Issue on Github](https://github.com/wilson0x4d/punit-testadapter/issues/new/choose).
