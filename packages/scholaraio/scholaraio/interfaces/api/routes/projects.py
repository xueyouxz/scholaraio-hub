"""Literature projects and which papers they hold."""
from __future__ import annotations

from fastapi import APIRouter

from scholaraio.interfaces.api.dependencies import Projects
from scholaraio.interfaces.api.responses import ArchivedProject, LiteratureProject, ProjectList
from scholaraio.interfaces.api.schemas import ProjectInput, ProjectPapersInput

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=ProjectList)
def list_projects(projects: Projects):
    return {"projects": projects.list()}


@router.post("", status_code=201, response_model=LiteratureProject)
def create_project(body: ProjectInput, projects: Projects):
    return projects.create(body.name)


@router.get("/{project_id}", response_model=LiteratureProject)
def project(project_id: str, projects: Projects):
    return projects.get(project_id)


@router.post("/{project_id}/rename", response_model=LiteratureProject)
def rename_project(project_id: str, body: ProjectInput, projects: Projects):
    return projects.rename(project_id, body.name)


@router.delete("/{project_id}", response_model=ArchivedProject)
def delete_project(project_id: str, projects: Projects):
    return projects.delete(project_id)


@router.post("/{project_id}/papers", response_model=LiteratureProject)
def update_project_papers(project_id: str, body: ProjectPapersInput, projects: Projects):
    return projects.update_papers(project_id, body.paper_ids, body.action)
