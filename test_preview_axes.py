import math
import pytest
from fastapi.testclient import TestClient

from measure_server import AxesPreviewRequest, app, preview_axes_raster


def _preview(**kwargs):
    return preview_axes_raster(AxesPreviewRequest(**kwargs))


def test_preview_axes_symmetric_labeled_origin_anchor():
    result = _preview(x_range=(-5, 5, 1), y_range=(-3, 3, 1), scale_x=1, scale_y=1,
                      x_label="x", y_label="y", include_numbers=True, include_tip=True)
    assert result.ok, result.error
    assert result.png_width > 0 and result.png_height > 0
    assert result.metadata_version == 1
    assert all(math.isfinite(v) for v in (result.left, result.right, result.top, result.bottom,
        result.origin_x, result.origin_y, result.x_unit_x, result.x_unit_y,
        result.y_unit_x, result.y_unit_y))
    # Recenter includes labels and therefore can move the graph origin off zero.
    # c2p(1, sin(1)) represented by the reported affine basis.
    px = result.origin_x + result.x_unit_x + math.sin(1) * result.y_unit_x
    py = result.origin_y + result.x_unit_y + math.sin(1) * result.y_unit_y
    assert math.isclose(px - result.origin_x, 1, abs_tol=1e-6)
    assert math.isclose(py - result.origin_y, math.sin(1), abs_tol=1e-6)


def test_preview_axes_non_symmetric_scaled_rect():
    result = _preview(x_range=(-2, 8, 2), y_range=(-1, 5, 1), scale_x=0.7, scale_y=1.3,
                      x_label="t", y_label="height", include_numbers=False, include_tip=False)
    assert result.ok, result.error
    assert math.isclose(result.coord_right - result.coord_left, 7, abs_tol=1e-6)
    assert math.isclose(result.coord_top - result.coord_bottom, 7.8, abs_tol=1e-6)


def test_preview_axes_crop_bounds_do_not_define_origin():
    result = _preview(x_range=(-5, 5, 1), y_range=(-3, 3, 1), x_label="x", y_label="height",
                      include_numbers=True)
    assert result.ok, result.error
    assert not math.isclose(result.origin_x, (result.left + result.right) / 2, abs_tol=1e-3) or not math.isclose(
        result.origin_y, (result.top + result.bottom) / 2, abs_tol=1e-3)


def test_preview_axes_rejects_bad_ranges_and_nonfinite_geometry():
    nonfinite = _preview(x_range=(-5, 5, float("nan")), y_range=(-3, 3, 1))
    assert not nonfinite.ok
    assert nonfinite.error and nonfinite.origin_x is None
    degenerate = _preview(x_range=(2, 2, 1), y_range=(-3, 3, 1))
    assert not degenerate.ok
    assert degenerate.error and degenerate.origin_x is None


@pytest.mark.parametrize("bad_number", ["NaN", "Infinity", "-Infinity"])
@pytest.mark.parametrize("field", ["scale_x", "x_range", "y_range"])
def test_preview_axes_api_returns_clean_error_for_nonfinite_json(field, bad_number):
    body = '{"x_range":[-5,5,1],"y_range":[-3,3,1],"scale_x":1,"scale_y":1}'
    if field == "scale_x":
        body = body.replace('"scale_x":1', f'"scale_x":{bad_number}')
    elif field == "x_range":
        body = body.replace('"x_range":[-5,5,1]', f'"x_range":[-5,5,{bad_number}]')
    else:
        body = body.replace('"y_range":[-3,3,1]', f'"y_range":[-3,3,{bad_number}]')
    response = TestClient(app).post("/api/preview_axes", content=body, headers={"content-type": "application/json"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]
    assert payload["origin_x"] is None and payload["metadata_version"] is None
