# Heimdall

Heimdall serves as a platform for creating, and joining socket namespaces.

## API | `/api`

All API requests require request body including the following...

```
{
  token: <access_token>
}
```

- `GET | /authorize`
  - Description
    - Validates identity
  - Returns
    - 401 - Failed to authenticate
    - 200 - Success
- `GET | /sessions`
  - Description
    - List of sessions available to join
- `GET | /sessions/:id`
  - Description
    - Information about a particular session
  - Returns
    - 401 - Failed to authenticate
    - 200 - Success
- `DELETE | /sessions/:id`
  - Description
    - Delete a session
  - Returns
    - 401 - Failed to authenticate
    - 200 - Success
- `POST | /sessions/create`
  - Description
    - Creates a session
  - Body
    ```
    {
      ...configurableOptions
    }
    ```
  - Returns
    - 401 - Failed to authenticate
    - 200 - Success
      - {
        room_id
      }

- `PUT | /sessions/join/:id`
  - Description
    - Join a session
  - Returns
    - 401 - Failed to authenticate
    - 200 - Success
      ```
      {
        id: session.id,
        access_pass: accessPass,
        creator_id: session.
      }
      ```
