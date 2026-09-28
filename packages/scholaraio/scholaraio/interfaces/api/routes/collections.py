"""Literature collections and which papers they hold."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from scholaraio.interfaces.api.dependencies import Collections
from scholaraio.interfaces.api.errors import require_json, success
from scholaraio.interfaces.api.responses import (
    ApiSuccess,
    ArchivedCollection,
    CollectionList,
    LiteratureCollection,
)
from scholaraio.interfaces.api.schemas import CollectionInput, CollectionPapersInput

router = APIRouter(prefix="/collections", tags=["collections"])


@router.get("", response_model=ApiSuccess[CollectionList])
def list_collections(request: Request, collections: Collections):
    """查询文献集合列表。"""
    return success(request, {"collections": collections.list()})


@router.post(
    "", status_code=201, response_model=ApiSuccess[LiteratureCollection], dependencies=[Depends(require_json)]
)
def create_collection(request: Request, body: CollectionInput, collections: Collections):
    """创建文献集合。"""
    return success(request, collections.create(body.name))


@router.get("/{collection_id}", response_model=ApiSuccess[LiteratureCollection])
def collection(request: Request, collection_id: str, collections: Collections):
    """查询文献集合详情。"""
    return success(request, collections.get(collection_id))


@router.post(
    "/{collection_id}/rename",
    response_model=ApiSuccess[LiteratureCollection],
    dependencies=[Depends(require_json)],
)
def rename_collection(request: Request, collection_id: str, body: CollectionInput, collections: Collections):
    """更新文献集合名称。"""
    return success(request, collections.rename(collection_id, body.name))


@router.delete("/{collection_id}", response_model=ApiSuccess[ArchivedCollection])
def delete_collection(request: Request, collection_id: str, collections: Collections):
    """归档文献集合。"""
    return success(request, collections.delete(collection_id))


@router.post(
    "/{collection_id}/papers",
    response_model=ApiSuccess[LiteratureCollection],
    dependencies=[Depends(require_json)],
)
def update_collection_papers(
    request: Request, collection_id: str, body: CollectionPapersInput, collections: Collections
):
    """修改文献集合中的论文。"""
    return success(request, collections.update_papers(collection_id, body.paper_ids, body.action))
