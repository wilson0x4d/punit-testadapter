# SPDX-FileCopyrightText: © 2026 Shaun Wilson
# SPDX-License-Identifier: MIT

"""Test fixture: pUnit test classes with decorated methods."""

from punit import fact


class TestAddition:
    @fact
    def test_basic(self):
        assert 1 + 1 == 2

    @fact
    def test_negative(self):
        assert (-1) + 1 == 0


class TestStringOps:
    @fact
    def test_lower(self):
        assert "HELLO".lower() == "hello"

    @fact
    def test_strip(self):
        assert "  spaced  ".strip() == "spaced"
