# SPDX-CopyrightText: © 2026 Shaun Wilson
# SPDX-License-Identifier: MIT

"""Test fixture: a regular Python file that is NOT a pUnit test module.

This file should be ignored by the test explorer since it doesn't
import anything from punit.
"""


def helper_function():
    return "not a test"
