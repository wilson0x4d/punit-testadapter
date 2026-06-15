# SPDX-FileCopyrightText: (c) 2026 Shaun Wilson
# SPDX-License-Identifier: MIT

"""Minimal pUnit fixture tests for the debug-hang integration test."""

from punit import fact


@fact
def test_addition():
    assert 1 + 1 == 2


@fact
def test_string_upper():
    assert "hello".upper() == "HELLO"


@fact
def test_list_append():
    result = [1, 2]
    result.append(3)
    assert len(result) == 3
