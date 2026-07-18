# SPDX-FileCopyrightText: © 2026 Shaun Wilson
# SPDX-License-Identifier: MIT

"""Test fixture: nested module in a subpackage."""

from punit import fact


@fact
def test_nested_module():
    assert True is True
