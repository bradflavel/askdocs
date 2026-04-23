from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import decode_access_token
from app.db import get_session
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


async def get_current_user(
    token: Annotated[str | None, Depends(oauth2_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="missing auth token")
    try:
        payload = decode_access_token(token)
    except ValueError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid token") from e
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    user = await session.get(User, int(user_id))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="user not found")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
