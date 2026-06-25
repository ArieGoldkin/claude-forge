# Architecture Diagram Patterns

## Table of Contents
- [1. Three-Tier Web Application](#1-three-tier-web-application)
- [2. Microservices with Message Queue](#2-microservices-with-message-queue)
- [3. AWS Lambda Serverless](#3-aws-lambda-serverless)
- [4. Event-Driven Architecture](#4-event-driven-architecture)
- [5. Hub-and-Spoke (Transit Gateway)](#5-hub-and-spoke-transit-gateway)
- [6. Layered Architecture](#6-layered-architecture)
- [Tips](#tips)

## 1. Three-Tier Web Application

```
+------------------+     +------------------+     +------------------+
|   Presentation   |     |   Application    |     |   Data Layer     |
|                  |---->|                  |---->|                  |
|  React SPA       |     |  API Gateway     |     |  PostgreSQL RDS  |
|  CloudFront CDN  |     |  Lambda Functions |     |  ElastiCache     |
+------------------+     +------------------+     +------------------+
```

## 2. Microservices with Message Queue

```
+----------+     +----------+     +----------+
| API      |---->| Auth     |     | Order    |
| Gateway  |     | Service  |     | Service  |
+----------+     +----------+     +----------+
     |                                 ^
     |           +-----------+         |
     +---------->| SQS Queue |-------->+
                 +-----------+
                      |
                      v
                 +-----------+
                 | Pricing   |
                 | Service   |
                 +-----------+
```

## 3. AWS Lambda Serverless

```
+-----------+     +-------------+     +-----------+
| CloudFront|---->| API Gateway |---->| Lambda    |
| (CDN)     |     | (REST)      |     | Functions |
+-----------+     +-------------+     +-----+-----+
                                            |
                  +------------+------------+------------+
                  |            |            |            |
                  v            v            v            v
            +-----+---+  +----+----+  +----+----+  +----+----+
            | DynamoDB |  |   RDS   |  |   S3    |  | Secrets |
            | (cache)  |  | (data)  |  | (files) |  | Manager |
            +----------+  +---------+  +---------+  +---------+
```

## 4. Event-Driven Architecture

```
+-----------+     +-----------+     +-----------+
| Producer  |---->| EventBridge|---->| Consumer A|
+-----------+     |  (bus)     |     +-----------+
                  +-----+------+
                        |
              +---------+---------+
              |                   |
              v                   v
        +-----------+       +-----------+
        | Consumer B|       | Consumer C|
        | (Lambda)  |       | (SQS+ECS) |
        +-----------+       +-----------+
              |                   |
              v                   v
        +-----------+       +-----------+
        | DynamoDB  |       |    S3     |
        +-----------+       +-----------+
```

## 5. Hub-and-Spoke (Transit Gateway)

```
                    +------------------+
                    |  Transit Gateway |
                    +--------+---------+
                             |
           +-----------------+-----------------+
           |                 |                 |
           v                 v                 v
    +------+------+   +------+------+   +------+------+
    |  VPC: Prod  |   |  VPC: Dev   |   |  VPC: Shared|
    |  10.1.0.0   |   |  10.2.0.0   |   |  10.0.0.0   |
    | +---------+ |   | +---------+ |   | +---------+ |
    | | Private  | |   | | Private  | |   | | DNS/NTP  | |
    | | Subnets  | |   | | Subnets  | |   | | Services | |
    | +---------+ |   | +---------+ |   | +---------+ |
    +-------------+   +-------------+   +-------------+
```

## 6. Layered Architecture

```
+-------------------------------------------------------+
|                    API Layer (REST)                     |
|  /users  /orders  /products  /reports                  |
+-------------------------------------------------------+
                          |
+-------------------------------------------------------+
|                  Service Layer                          |
|  AuthService  OrderService  PricingService             |
+-------------------------------------------------------+
                          |
+-------------------------------------------------------+
|                  Domain Layer                           |
|  User  Order  Product  Invoice                          |
+-------------------------------------------------------+
                          |
+-------------------------------------------------------+
|               Infrastructure Layer                      |
|  SQLAlchemy ORM  S3 Client  SQS Publisher              |
+-------------------------------------------------------+
```

## Tips

- **Same row = same tier/level.** Don't mix abstraction levels horizontally.
- **Arrows = data flow.** Right arrows for requests, left for responses (or label them).
- **Supporting services below.** Place databases, caches, and storage on the bottom row.
- **Label arrow lines** when the connection type isn't obvious (REST, gRPC, async).
