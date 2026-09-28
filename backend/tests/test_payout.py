import pytest

from app.payout import (PayoutError, advance_recovery, build_cycle_lines, job_amount, normalise_colours, pieces_for,
                        worker_balance)
from app.utils import inr, split_bilingual

LOT128 = {"lot_no": "128", "colours": [{"code": "A", "qty": 77}, {"code": "B", "qty": 70}, {"code": "C", "qty": 53}]}


def test_single_colour_front_and_back():
    pcs = pieces_for(LOT128, ["A"])
    assert pcs == 77
    assert job_amount(pcs, 14.50) == 1116.50
    assert job_amount(pcs, 25.00) == 1925.00


def test_multi_colour_and_all():
    assert pieces_for(LOT128, ["A", "C"]) == 130
    assert pieces_for(LOT128, ["ALL"]) == 200


def test_split_pieces_override():
    assert pieces_for(LOT128, ["A"], split_pieces=40) == 40


def test_normalise_colours():
    assert normalise_colours(["c", "a", "A"], LOT128) == ["A", "C"]
    assert normalise_colours(["all"], LOT128) == ["ALL"]
    with pytest.raises(PayoutError):
        normalise_colours(["Z"], LOT128)
    with pytest.raises(PayoutError):
        normalise_colours(["ALL", "A"], LOT128)
    with pytest.raises(PayoutError):
        normalise_colours([], LOT128)


def test_rounding_half_up_and_nearest_rupee():
    assert job_amount(3, 0.335) == 1.01  # 1.005 -> 1.01 (half-up, not banker's)
    assert job_amount(77, 14.5, "NEAREST_1") == 1117.0


def test_advance_recovery_cap():
    assert advance_recovery(5000, 3000, 50) == 1500  # capped at 50% of gross
    assert advance_recovery(800, 3000, 50) == 800  # whole advance fits
    assert advance_recovery(800, 0, 50) == 0


def test_cycle_lines():
    jobs = [{"_id": "j1", "worker_id": "w1", "amount": 1116.5}, {"_id": "j2", "worker_id": "w1", "amount": 1925},
            {"_id": "j3", "worker_id": "w2", "amount": 500}]
    deds = [{"_id": "d1", "worker_id": "w2", "amount": 100}]
    lines = {l.worker_id: l for l in build_cycle_lines(jobs, deds, {"w1": 1000, "w2": 1000}, 50)}
    assert lines["w1"].gross == 3041.5 and lines["w1"].advance_recovery == 1000 and lines["w1"].net_payable == 2041.5
    # w2: cap 250 (50% of 500), deduction 100 -> net 150
    assert lines["w2"].advance_recovery == 250 and lines["w2"].net_payable == 150


def test_recovery_never_makes_net_negative():
    lines = build_cycle_lines([{"_id": "j", "worker_id": "w", "amount": 100}],
                              [{"_id": "d", "worker_id": "w", "amount": 90}], {"w": 1000}, 100)
    assert lines[0].advance_recovery == 10 and lines[0].net_payable == 0


def test_balance_and_formatting():
    assert worker_balance(3041.5, 1000, 0, 2041.5) == 0
    assert inr(123456.5) == "₹1,23,456.50"
    assert inr(-500) == "-₹500.00"
    assert split_bilingual("सूरज (SURAJ)") == ("SURAJ", "सूरज")
    assert split_bilingual("Gulam") == ("Gulam", "")
