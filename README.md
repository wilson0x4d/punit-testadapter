
..an "official" test-adapter for [pUnit](https://pypi.org/project/pUnit/), a modernized Python unit-test framework inspired by `xUnit`.

## Requirements

In your Python workspace you should install [`pUnit>=1.3`](https://pypi.org/project/pUnit/) as a development dependency.

Moving forward this extension will maintain compatibility with graceful handling of older versions.

## Contributing

Compared to any other project of mine absolutely this could use a lot of TLC, I will gladly authorize anyone that wants to help improve it as long as they can gpg sign their commits and do basic regression testing (or, even better, implement some unit tests ... something I skipped on this since I have much larger projects I need to be working on.)

### TODO

- modularize the code instead of the wall of text it is right now.
- add unit tests to verify basic functionality, current test effort has been entirely manual (and dog fooding.)
- setup workflow for build, test, package and updating releases.

### Development

For debugging the extension you will need to edit the included debug config to point at a valid Python project that has `pUnit` installed.

## Contact

You can reach me on [Discord](https://discordapp.com/users/307684202080501761) or [open an Issue on Github](https://github.com/wilson0x4d/punit-testadapter/issues/new/choose).

