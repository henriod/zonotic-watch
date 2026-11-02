"""MoH-confirmed Ebola case figures.

`GET /ebola` is public (newest first; the dashboard shows the first row).
`POST` / `DELETE` are admin-only. The schema rejects any source that is
not an @MOH_Kenya post or a health.go.ke page.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import EbolaCase, User
from app.db.session import get_session
from app.schemas.ebola import EbolaCaseIn, EbolaCaseOut
from app.security import require_admin

router = APIRouter(prefix="/ebola", tags=["ebola"])


@router.get("", response_model=list[EbolaCaseOut])
async def list_ebola_cases(
    limit: int = Query(50, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
) -> list[EbolaCase]:
    rows = await session.execute(
        select(EbolaCase)
        .order_by(EbolaCase.reported_on.desc(), EbolaCase.id.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())


@router.post("", response_model=EbolaCaseOut, status_code=status.HTTP_201_CREATED)
async def create_ebola_case(
    payload: EbolaCaseIn,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> EbolaCase:
    row = EbolaCase(**payload.model_dump(), created_by=admin.id)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


@router.delete("/{case_id}", response_class=Response, status_code=204)
async def delete_ebola_case(
    case_id: int,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> Response:
    row = await session.get(EbolaCase, case_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)
