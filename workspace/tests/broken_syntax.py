# SPDX-CopyrightText: © 2026 Shaun Wilson
# SPDX-License-Identifier: MIT

"""Test fixture: file with intentional syntax error.

This file is used by integration tests to verify the extension
handles parse failures gracefully without crashing the test explorer.
"""

from punit iimport fact  # deliberate typo: 'iimport' instead of 'import'


@fact
def test_something():
    assert True


# Introduce a real syntax error below:
def broken_function(
    # missing closing paren
    pass  # syntax error: 'pass' not valid in function body after 'pass' above
