"""HebrewMatrix: one compile split into entries, brackets and bar (needs xelatex, like the other tests)."""

import numpy as np
import pytest
from manim import RED, RIGHT, WHITE, ManimColor

from hebrew_matrix import HebrewMatrix, MatrixStep, matrix_tex_source


def test_source_tags_every_entry_and_keeps_unary_minus():
    src = matrix_tex_source([["1", "-3"]], "square", "right", None)
    assert r"\begin{array}{@{}rr@{}}" in src
    assert "{-3}}" in src  # entry braced on its own: the minus stays unary
    assert src.count(r"\color[RGB]") == 5  # left, bar, 2 entries, right


def test_augment_bar_and_none_brackets_in_source():
    src = matrix_tex_source([["1", "0", "2"]], "none", "center", 2)
    assert r"\left" not in src and r"\right" not in src
    assert r"cc!{\color[RGB]{250,1,3}\vrule}c" in src


def test_splits_entries_brackets_and_bar():
    m = HebrewMatrix([["1", "0", "2"], ["0", "1", "-3"]], bracket="square", augment_col=2)
    assert len(m._entries) == 6 and all(e.submobjects for e in m._entries)
    left, right = m.get_brackets()
    assert left.submobjects and right.submobjects and m.get_bar().submobjects
    assert left.get_right()[0] < m.get_entries().get_left()[0]
    assert right.get_left()[0] > m.get_entries().get_right()[0]
    # The bar sits between the second and third columns.
    assert m.get_entry(0, 1).get_right()[0] < m.get_bar().get_center()[0] < m.get_entry(0, 2).get_left()[0]
    assert len(m.get_rows()) == 2 and len(m.get_columns()) == 3


def test_empty_cells_colours_and_cells():
    m = HebrewMatrix([["x", ""], ["", "y"]], bracket="none", entry_colors=[[RED, None], [None, None]])
    assert not m.get_entry(0, 1).submobjects
    assert not m.get_brackets()[0].submobjects
    assert len(m.cells((0, 0), (0, 1), (1, 1))) == 2
    assert ManimColor(m.get_entry(0, 0)[0].get_fill_color()) == ManimColor(RED)
    assert ManimColor(m.get_entry(1, 1)[0].get_fill_color()) == ManimColor(WHITE)


def test_strike_lines_cross_rows_columns_and_single_cells():
    m = HebrewMatrix([["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]])
    # Row 0 and column 2 (as for the minor M_02): two lines.
    sel = [(0, j) for j in range(3)] + [(i, 2) for i in range(3)]
    assert len(m.strike_lines(sel)) == 2
    assert len(m.strike_lines([(1, 1)])) == 1


def test_rejects_ragged_rows_and_unknown_bracket():
    with pytest.raises(ValueError):
        HebrewMatrix([["1", "2"], ["3"]])
    with pytest.raises(ValueError):
        HebrewMatrix([["1"]], bracket="angle")


def _play(step):
    step.begin()
    step.interpolate(0.5)
    step.finish()


def test_matrix_step_swaps_rows_in_place_keeping_colours_scale_and_centre():
    m = HebrewMatrix([["1", "2"], ["3", "4"]], entry_colors=[[RED, None], [None, None]])
    m.scale(1.5).shift(RIGHT)
    center, scale = m.get_center().copy(), m.current_scale()
    _play(MatrixStep(m, [["3", "4"], ["1", "2"]], swap=(0, 1)))
    assert m.entry_tex == [["3", "4"], ["1", "2"]]
    # The red 1 moved down with its row; the same object is now the new matrix.
    assert ManimColor(m.get_entry(1, 0)[0].get_fill_color()) == ManimColor(RED)
    assert ManimColor(m.get_entry(0, 0)[0].get_fill_color()) == ManimColor(WHITE)
    assert abs(m.current_scale() - scale) < 1e-6
    assert np.allclose(m.get_center(), center, atol=1e-6)
    assert m.get_entry(0, 0).get_center()[1] > m.get_entry(1, 0).get_center()[1]


def test_matrix_step_changes_entries_and_transposes():
    m = HebrewMatrix([["1", "2", "3"], ["4", "5", "6"]], augment_col=2)
    _play(MatrixStep(m, [["1", "2", "3"], ["0", "-3", "-6"]]))
    assert m.entry_tex[1] == ["0", "-3", "-6"] and m.get_bar().submobjects
    _play(MatrixStep(m, [["1", "0"], ["2", "-3"], ["3", "-6"]], transpose=True))
    assert (m.n_rows, m.n_cols) == (3, 2) and m.augment_col is None
    assert not m.get_bar().submobjects
    assert len(m.cells((2, 0), (2, 1))) == 2
    assert m.get_brackets()[0].height > m.get_entries().height


def test_bounds_ignore_empty_pieces_after_moving():
    # No bar, no brackets and a blank entry: none of them may pull the bounds to the origin.
    m = HebrewMatrix([["1", ""], ["3", "4"]], bracket="none")
    w, h = m.width, m.height
    m.shift(3 * RIGHT)
    assert abs(m.width - w) < 1e-9 and abs(m.height - h) < 1e-9
