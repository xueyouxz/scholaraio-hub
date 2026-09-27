"""Literature projects and which papers they hold."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from scholaraio.interfaces.api.dependencies import Projects
from scholaraio.interfaces.api.errors import require_json, success
from scholaraio.interfaces.api.responses import ApiSuccess, ArchivedProject, LiteratureProject, ProjectList
from scholaraio.interfaces.api.schemas import ProjectInput, ProjectPapersInput

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=ApiSuccess[ProjectList])
def list_projects(request: Request, projects: Projects):
    """查询文献项目列表。"""
    return success(request, {"projects": projects.list()})


@router.post("", status_code=201, response_model=ApiSuccess[LiteratureProject], dependencies=[Depends(require_json)])
def create_project(request: Request, body: ProjectInput, projects: Projects):
    """创建文献项目。"""
    return success(request, projects.create(body.name))


@router.get("/{project_id}", response_model=ApiSuccess[LiteratureProject])
def project(request: Request, project_id: str, projects: Projects):
    """查询文献项目详情。"""
    return success(request, projects.get(project_id))


@router.post("/{project_id}/rename", response_model=ApiSuccess[LiteratureProject], dependencies=[Depends(require_json)])
def rename_project(request: Request, project_id: str, body: ProjectInput, projects: Projects):
    """更新文献项目名称。"""
    return success(request, projects.rename(project_id, body.name))


@router.delete("/{project_id}", response_model=ApiSuccess[ArchivedProject])
def delete_project(request: Request, project_id: str, projects: Projects):
    """归档文献项目。"""
    return success(request, projects.delete(project_id))


@router.post("/{project_id}/papers", response_model=ApiSuccess[LiteratureProject], dependencies=[Depends(require_json)])
def update_project_papers(request: Request, project_id: str, body: ProjectPapersInput, projects: Projects):
    """修改文献项目中的论文集合。"""
    return success(request, projects.update_papers(project_id, body.paper_ids, body.action))
